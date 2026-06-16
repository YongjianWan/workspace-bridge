package com.example.tricky;

import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class TrickyController {
    
    @GetMapping("/users")
    public List<String> getUsers() {
        return Collections.singletonList("alice");
    }
}
