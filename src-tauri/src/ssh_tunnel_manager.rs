use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshPortForward {
    pub id: String,
    pub ssh_host: String,
    pub remote_port: u16,
    pub local_port: u16,
    pub remote_host: String,
    pub created_at: u64,
}

pub struct TunnelProcess {
    pub forward: SshPortForward,
    pub child: Child,
}

#[derive(Clone, Default)]
pub struct SshTunnelManager {
    tunnels: Arc<Mutex<HashMap<String, TunnelProcess>>>,
}

impl SshTunnelManager {
    pub fn new() -> Self {
        Self {
            tunnels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Check if a local port is available on loopback
    pub fn is_local_port_available(port: u16) -> bool {
        TcpListener::bind(("127.0.0.1", port)).is_ok()
    }

    /// Allocate a random free local port on loopback
    pub fn find_free_local_port() -> Result<u16, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|e| format!("Failed to find free local port: {}", e))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to read local socket address: {}", e))?
            .port();
        drop(listener);
        Ok(port)
    }

    /// Start an SSH port forward in the background
    pub fn start_forward(
        &self,
        ssh_host: &str,
        remote_port: u16,
        requested_local_port: Option<u16>,
        remote_host: Option<&str>,
    ) -> Result<SshPortForward, String> {
        let clean_host = ssh_host.trim();
        if clean_host.is_empty() {
            return Err("SSH host cannot be empty".to_string());
        }
        if remote_port == 0 {
            return Err("Remote port must be greater than 0".to_string());
        }

        let target_remote_host = match remote_host {
            Some(h) if !h.trim().is_empty() => h.trim().to_string(),
            _ => "127.0.0.1".to_string(),
        };

        // 1. Check if an active tunnel already exists for this exact host and remote port
        {
            let mut lock = self.tunnels.lock();
            let mut dead_ids = Vec::new();

            for (id, tunnel) in lock.iter_mut() {
                if tunnel.forward.ssh_host == clean_host
                    && tunnel.forward.remote_port == remote_port
                    && tunnel.forward.remote_host == target_remote_host
                {
                    match tunnel.child.try_wait() {
                        Ok(None) => {
                            // Active and still running! Reuse this forward
                            return Ok(tunnel.forward.clone());
                        }
                        _ => {
                            // Already exited
                            dead_ids.push(id.clone());
                        }
                    }
                }
            }

            for id in dead_ids {
                lock.remove(&id);
            }
        }

        // 2. Determine local port:
        // If specified, use it (or return error if in use).
        // If not specified, try using remote_port locally; if occupied, pick an available port.
        let local_port = match requested_local_port {
            Some(p) if p > 0 => {
                if !Self::is_local_port_available(p) {
                    return Err(format!("Local port {} is already in use", p));
                }
                p
            }
            _ => {
                if Self::is_local_port_available(remote_port) {
                    remote_port
                } else {
                    Self::find_free_local_port()?
                }
            }
        };

        let forward_id = format!("tunnel-{}", Uuid::new_v4());
        let forward_arg = format!("127.0.0.1:{}:{}:{}", local_port, target_remote_host, remote_port);

        #[cfg(debug_assertions)]
        println!(
            ">>> [SshTunnelManager] Spawning SSH tunnel: host={}, -L {}",
            clean_host, forward_arg
        );

        let mut cmd = Command::new("ssh");
        cmd.arg("-N")
            .arg("-L")
            .arg(&forward_arg)
            .arg("-o")
            .arg("ExitOnForwardFailure=yes")
            .arg("-o")
            .arg("ServerAliveInterval=15")
            .arg("-o")
            .arg("ServerAliveCountMax=3")
            .arg("-o")
            .arg("StrictHostKeyChecking=accept-new")
            .arg(clean_host)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn SSH command for port forwarding: {}", e))?;

        // 3. Monitor early exit / readiness
        let start_time = Instant::now();
        let timeout = Duration::from_millis(1800);
        let check_interval = Duration::from_millis(50);
        let mut is_ready = false;

        while start_time.elapsed() < timeout {
            // Did the process exit with an error?
            match child.try_wait() {
                Ok(Some(status)) => {
                    let mut stderr_msg = String::new();
                    if let Some(mut err_pipe) = child.stderr.take() {
                        let _ = err_pipe.read_to_string(&mut stderr_msg);
                    }
                    let detail = if stderr_msg.trim().is_empty() {
                        status.to_string()
                    } else {
                        stderr_msg.trim().to_string()
                    };
                    return Err(format!("SSH tunnel exited immediately: {}", detail));
                }
                Ok(None) => {
                    // Check if local port is now bound and listening
                    let target_addr = SocketAddr::from(([127, 0, 0, 1], local_port));
                    if TcpStream::connect_timeout(&target_addr, Duration::from_millis(40)).is_ok() {
                        is_ready = true;
                        break;
                    }
                }
                Err(e) => {
                    return Err(format!("Failed to query SSH process status: {}", e));
                }
            }
            std::thread::sleep(check_interval);
        }

        // If child is still running after timeout, even if connect test timed out (e.g. remote service
        // isn't responding yet until first HTTP request), we consider the tunnel started as long as child is alive.
        if !is_ready {
            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!("SSH tunnel failed to initialize: {}", status));
            }
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let forward = SshPortForward {
            id: forward_id.clone(),
            ssh_host: clean_host.to_string(),
            remote_port,
            local_port,
            remote_host: target_remote_host,
            created_at: now,
        };

        let tunnel_proc = TunnelProcess {
            forward: forward.clone(),
            child,
        };

        self.tunnels.lock().insert(forward_id, tunnel_proc);
        Ok(forward)
    }

    /// Stop an active SSH port forward by ID
    pub fn stop_forward(&self, id: &str) -> Result<(), String> {
        let mut lock = self.tunnels.lock();
        if let Some(mut tunnel) = lock.remove(id) {
            #[cfg(debug_assertions)]
            println!(">>> [SshTunnelManager] Stopping SSH tunnel {}", id);
            let _ = tunnel.child.kill();
            let _ = tunnel.child.wait();
            Ok(())
        } else {
            Err(format!("No active SSH tunnel found with ID {}", id))
        }
    }

    /// List all currently active SSH port forwards
    pub fn get_active_forwards(&self, ssh_host_filter: Option<&str>) -> Vec<SshPortForward> {
        let mut lock = self.tunnels.lock();
        let mut active = Vec::new();
        let mut dead_ids = Vec::new();

        for (id, tunnel) in lock.iter_mut() {
            match tunnel.child.try_wait() {
                Ok(None) => {
                    if let Some(filter) = ssh_host_filter {
                        if !filter.trim().is_empty() && tunnel.forward.ssh_host != filter.trim() {
                            continue;
                        }
                    }
                    active.push(tunnel.forward.clone());
                }
                _ => {
                    dead_ids.push(id.clone());
                }
            }
        }

        for id in dead_ids {
            lock.remove(&id);
        }

        active
    }

    /// Terminate all running tunnels
    pub fn stop_all(&self) {
        let mut lock = self.tunnels.lock();
        for (_, mut tunnel) in lock.drain() {
            let _ = tunnel.child.kill();
            let _ = tunnel.child.wait();
        }
    }
}

impl Drop for SshTunnelManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_local_port_available() {
        let free_port = SshTunnelManager::find_free_local_port().expect("should find free port");
        assert!(free_port > 0);
        assert!(SshTunnelManager::is_local_port_available(free_port));

        // Bind port to test unavailable
        let listener = TcpListener::bind(("127.0.0.1", free_port)).unwrap();
        assert!(!SshTunnelManager::is_local_port_available(free_port));
        drop(listener);

        assert!(SshTunnelManager::is_local_port_available(free_port));
    }

    #[test]
    fn test_start_forward_validates_inputs() {
        let manager = SshTunnelManager::new();

        let empty_host = manager.start_forward("", 3000, None, None);
        assert!(empty_host.is_err());
        assert!(empty_host.unwrap_err().contains("cannot be empty"));

        let zero_port = manager.start_forward("user@host", 0, None, None);
        assert!(zero_port.is_err());
        assert!(zero_port.unwrap_err().contains("greater than 0"));
    }
}
