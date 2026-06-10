use rodio::{Decoder, OutputStream, Sink};
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::thread;

pub struct AudioPlayer {
    sink: Arc<Mutex<Option<Sink>>>,
}

impl AudioPlayer {
    pub fn new() -> Self {
        let sink_mutex = Arc::new(Mutex::new(None));
        let sink_clone = Arc::clone(&sink_mutex);

        thread::spawn(move || {
            // OutputStream must be kept alive on this thread.
            if let Ok((_stream, stream_handle)) = OutputStream::try_default() {
                if let Ok(sink) = Sink::try_new(&stream_handle) {
                    let mut lock = sink_clone.lock().unwrap();
                    *lock = Some(sink);
                }
                // Keep the audio thread alive indefinitely
                loop {
                    thread::park();
                }
            }
        });

        Self { sink: sink_mutex }
    }

    pub fn play_sound_bytes(&self, bytes: &[u8]) {
        let lock = self.sink.lock().unwrap();
        if let Some(sink) = lock.as_ref() {
            let cursor = Cursor::new(bytes.to_vec());
            if let Ok(decoder) = Decoder::new(cursor) {
                sink.append(decoder);
                sink.play();
            }
        }
    }
}
