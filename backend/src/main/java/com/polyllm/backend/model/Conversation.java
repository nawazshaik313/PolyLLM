package com.polyllm.backend.model;

import java.time.LocalDateTime;
import java.util.List;

public record Conversation(
        String id,
        String title,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        List<ChatMessage> messages
) {}
