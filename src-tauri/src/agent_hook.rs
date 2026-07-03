use std::thread;
use tauri::{AppHandle, Emitter};
use tiny_http::{Method, Response, Server, StatusCode};

/// Preferred port for the hook server. Kept as the default so existing hook
/// configs pointing at 127.0.0.1:1421 keep working; if it's already taken
/// (e.g. another Termspace instance is running) we fall back to an
/// OS-assigned port rather than silently not listening at all.
const PREFERRED_PORT: u16 = 1421;

pub fn start_server(app: AppHandle) {
    thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PREFERRED_PORT)) {
            Ok(s) => s,
            Err(primary_err) => match Server::http("127.0.0.1:0") {
                Ok(s) => {
                    #[cfg(debug_assertions)]
                    println!(
                        ">>> RUST: port {PREFERRED_PORT} unavailable ({primary_err}); agent hook server fell back to a random port"
                    );
                    s
                }
                Err(fallback_err) => {
                    #[cfg(debug_assertions)]
                    println!(">>> RUST: Failed to start agent hook server: {fallback_err}");
                    return;
                }
            },
        };

        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(PREFERRED_PORT);
        #[cfg(debug_assertions)] println!(">>> RUST: Agent hook server listening on 127.0.0.1:{port}");
        let _ = app.emit("agent-hook-port", port);

        for mut request in server.incoming_requests() {
            if request.method() == &Method::Post && request.url() == "/hook" {
                let mut content = String::new();
                if request.as_reader().read_to_string(&mut content).is_ok() {
                    // Emit the payload to the frontend
                    let _ = app.emit("agent-hook-event", &content);
                    let response = Response::from_string("OK").with_status_code(StatusCode(200));
                    let _ = request.respond(response);
                } else {
                    let response = Response::from_string("Bad Request").with_status_code(StatusCode(400));
                    let _ = request.respond(response);
                }
            } else {
                let response = Response::from_string("Not Found").with_status_code(StatusCode(404));
                let _ = request.respond(response);
            }
        }
    });
}
