package com.polyllm.backend.model;

import java.time.LocalDateTime;

public record ChatMessage(
        Long id,
        String conversationId,
        String role,
        String content,
        String model,
        LocalDateTime createdAt
) {}
