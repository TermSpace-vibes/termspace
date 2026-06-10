use std::thread;
use tauri::{AppHandle, Emitter};
use tiny_http::{Method, Response, Server, StatusCode};

pub fn start_server(app: AppHandle) {
    thread::spawn(move || {
        let server = match Server::http("127.0.0.1:1421") {
            Ok(s) => s,
            Err(e) => {
                #[cfg(debug_assertions)] println!(">>> RUST: Failed to start agent hook server: {}", e);
                return;
            }
        };

        #[cfg(debug_assertions)] println!(">>> RUST: Agent hook server listening on 127.0.0.1:1421");

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
