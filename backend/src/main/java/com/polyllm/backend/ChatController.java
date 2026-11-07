
package com.polyllm.backend;

import com.polyllm.backend.model.Conversation;
import com.polyllm.backend.service.ChatStorageService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = {
    "http://localhost:5173",
    "http://localhost:5175"
})
public class ChatController {

    private final ChatStorageService storage;
    private final RestClient ollama = RestClient.builder()
            .baseUrl("http://localhost:11434")
            .build();

    public ChatController(ChatStorageService storage) {
        this.storage = storage;
    }

    @GetMapping("/conversations")
    public List<Conversation> listConversations() {
        return storage.listConversations();
    }

    @PostMapping("/conversations")
    public Conversation createConversation(
            @RequestBody Map<String, String> request) {
        String title = request.getOrDefault("title", "New chat").trim();
        if (title.isEmpty()) title = "New chat";
        if (title.length() > 200) title = title.substring(0, 200);
        return storage.createConversation(title);
    }

    @GetMapping("/conversations/{id}")
    public Conversation getConversation(@PathVariable String id) {
        try {
            return storage.getConversation(id);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Conversation not found");
        }
    }

    @DeleteMapping("/conversations/{id}")
    public Map<String, String> deleteConversation(@PathVariable String id) {
        storage.deleteConversation(id);
        return Map.of("message", "Conversation deleted");
    }

    @PostMapping("/conversations/{id}/messages")
    public Map<String, Object> sendMessage(
            @PathVariable String id,
            @RequestBody Map<String, String> request) {

        String message = request.getOrDefault("message", "").trim();
        String model = request.getOrDefault("model", "qwen3:8b");

        if (message.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Message cannot be empty");
        }

        if (!model.equals("qwen3:8b")
                && !model.equals("deepseek-r1:7b")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Unsupported model");
        }

        try {
            storage.addMessage(id, "user", message, model);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Conversation not found");
        }

        try {
            Map<String, Object> response = ollama.post()
                    .uri("/api/chat")
                    .body(Map.of(
                            "model", model,
                            "messages", List.of(
                                    Map.of("role", "user", "content", message)),
                            "stream", false))
                    .retrieve()
                    .body(Map.class);

            if (response == null
                    || !(response.get("message") instanceof Map<?, ?> answer)
                    || !(answer.get("content") instanceof String reply)) {
                throw new IllegalStateException("Invalid response from Ollama");
            }

            storage.addMessage(id, "assistant", reply, model);

            return Map.of("reply", reply, "model", model);
        } catch (Exception ex) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "The AI model failed to respond. Your message was saved.",
                    ex);
        }
    }
}
