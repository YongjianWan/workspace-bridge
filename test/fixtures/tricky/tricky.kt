package com.example.tricky

import io.ktor.server.application.*
import io.ktor.server.routing.*
import io.ktor.server.response.*

fun Application.module() {
    routing {
        get("/hello") {
            call.respondText("Hello World!")
        }
    }
}

class CompanionHolder {
    companion object {
        const val CONSTANT = "value"
        fun create() = CompanionHolder()
    }
}
