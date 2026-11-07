
package com.polyllm.backend.service;

import com.polyllm.backend.model.ChatMessage;
import com.polyllm.backend.model.Conversation;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class ChatStorageService {

    private final JdbcTemplate jdbc;

    public ChatStorageService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // Get all conversations, newest activity first
    public List<Conversation> listConversations() {
        return jdbc.query("""
                SELECT id, title, created_at, updated_at
                FROM conversations
                ORDER BY updated_at DESC
                """, (rs, row) -> new Conversation(
                rs.getString("id"),
                rs.getString("title"),
                rs.getTimestamp("created_at").toLocalDateTime(),
                rs.getTimestamp("updated_at").toLocalDateTime(),
                List.of()
        ));
    }

    // Get one conversation, including its messages
    public Conversation getConversation(String id) {
        List<Conversation> result = jdbc.query("""
                SELECT id, title, created_at, updated_at
                FROM conversations
                WHERE id = ?
                """, (rs, row) -> {
            String conversationId = rs.getString("id");

            return new Conversation(
                    conversationId,
                    rs.getString("title"),
                    rs.getTimestamp("created_at").toLocalDateTime(),
                    rs.getTimestamp("updated_at").toLocalDateTime(),
                    listMessages(conversationId)
            );
        }, id);

        if (result.isEmpty()) {
            throw new IllegalArgumentException("Conversation not found");
        }

        return result.get(0);
    }

    // Get messages belonging to a conversation
    private List<ChatMessage> listMessages(String conversationId) {
        return jdbc.query("""
                SELECT id, conversation_id, role, content, model, created_at
                FROM chat_messages
                WHERE conversation_id = ?
                ORDER BY id ASC
                """, (rs, row) -> new ChatMessage(
                rs.getLong("id"),
                rs.getString("conversation_id"),
                rs.getString("role"),
                rs.getString("content"),
                rs.getString("model"),
                rs.getTimestamp("created_at").toLocalDateTime()
        ), conversationId);
    }

    // Create a new conversation
    @Transactional
    public Conversation createConversation(String title) {
        String id = UUID.randomUUID().toString();

        String safeTitle = (title == null || title.isBlank())
                ? "New chat"
                : title.trim();

        if (safeTitle.length() > 200) {
            safeTitle = safeTitle.substring(0, 200);
        }

        jdbc.update("""
                INSERT INTO conversations (id, title)
                VALUES (?, ?)
                """, id, safeTitle);

        return getConversation(id);
    }

    // Save a user or assistant message
    @Transactional
    public void addMessage(
            String conversationId,
            String role,
            String content,
            String model) {

        if (!conversationExists(conversationId)) {
            throw new IllegalArgumentException("Conversation not found");
        }

        if (role == null
                || (!role.equals("user") && !role.equals("assistant"))) {
            throw new IllegalArgumentException(
                    "Role must be user or assistant");
        }

        if (content == null || content.isBlank()) {
            throw new IllegalArgumentException(
                    "Message content cannot be empty");
        }

        // Save the message
        jdbc.update("""
                INSERT INTO chat_messages
                    (conversation_id, role, content, model)
                VALUES (?, ?, ?, ?)
                """, conversationId, role, content, model);

        // Automatically title a new conversation using its first user message
        if ("user".equals(role)) {
            String title = content.trim();

            if (title.length() > 42) {
                title = title.substring(0, 42) + "…";
            }

            jdbc.update("""
                    UPDATE conversations
                    SET title = CASE
                        WHEN title = 'New chat' THEN ?
                        ELSE title
                    END
                    WHERE id = ?
                    """, title, conversationId);
        }

        // Update the conversation's last activity time
        jdbc.update("""
                UPDATE conversations
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """, conversationId);
    }

    // Delete a conversation and all its messages
    @Transactional
    public void deleteConversation(String id) {
        jdbc.update(
                "DELETE FROM chat_messages WHERE conversation_id = ?",
                id);

        jdbc.update(
                "DELETE FROM conversations WHERE id = ?",
                id);
    }

    // Check whether a conversation exists
    private boolean conversationExists(String id) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM conversations WHERE id = ?",
                Integer.class,
                id);

        return count != null && count > 0;
    }
}
