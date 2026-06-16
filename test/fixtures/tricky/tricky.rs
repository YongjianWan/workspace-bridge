use actix_web::{get, web, App, HttpResponse, HttpServer, Responder};

#[get("/hello")]
async fn index() -> impl Responder {
    HttpResponse::Ok().body("Hello world!")
}

pub struct Repository {
    pub name: String,
}

impl Repository {
    pub fn new(name: &str) -> Self {
        Repository {
            name: name.to_string(),
        }
    }
}
