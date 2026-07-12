use adblock::engine::Engine;
use adblock::lists::ParseOptions;
use adblock::request::Request;

fn main() {
    let rules = vec!["||doubleclick.net^", "||googleadservices.com^"];
    let mut engine = Engine::from_rules(&rules, ParseOptions::default());
    let url = "https://googleadservices.com/pagead/aclk";
    let req = Request::new(url, url, "").unwrap();
    let block_result = engine.check_network_request(&req);
    println!("Blocked: {:?}", block_result.matched);
}
