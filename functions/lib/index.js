import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { Client } from 'anthropic';
import { getFirebaseApp } from './firebase.js';
import { createMessageSchema } from './schemas/message.js';
const claudeApiKey = defineSecret('CLAUDE_API_KEY');
const app = getFirebaseApp();
const db = getFirestore(app);
export const createAssistantMessage = onCall({
    cors: true,
    region: 'us-central1',
    secrets: [claudeApiKey],
}, async (request) => {
    const { auth, data } = request;
    if (!auth) {
        throw new HttpsError('unauthenticated', 'Sign in to call this function');
    }
    const parsed = createMessageSchema.safeParse(data);
    if (!parsed.success) {
        throw new HttpsError('invalid-argument', parsed.error.message);
    }
    const { topicId, content } = parsed.data;
    const topicRef = db.collection('topics').doc(topicId);
    const topicSnapshot = await topicRef.get();
    if (!topicSnapshot.exists) {
        throw new HttpsError('not-found', 'Topic not found');
    }
    if (topicSnapshot.data()?.ownerId !== auth.uid) {
        throw new HttpsError('permission-denied', 'You do not own this topic');
    }
    // Collect prior thread for context (lightly capped to avoid token bloat).
    const historySnapshot = await topicRef
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .limit(30)
        .get();
    const historyMessages = historySnapshot.docs
        .map((doc) => doc.data())
        .filter((msg) => typeof msg.content === 'string' && typeof msg.role === 'string')
        .map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
    })) ?? [];
    const client = new Client({ apiKey: claudeApiKey.value() });
    const response = await client.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 512,
        messages: [
            ...historyMessages.map((msg) => ({
                role: msg.role,
                content: [{ type: 'text', text: msg.content }],
            })),
            { role: 'user', content: [{ type: 'text', text: content }] },
        ],
    });
    const textPart = response.content.find((part) => part.type === 'text');
    const assistantContent = textPart && 'text' in textPart
        ? textPart.text
        : '[Claude] No text content returned from API.';
    const assistantMessageRef = topicRef.collection('messages').doc();
    await assistantMessageRef.set({
        content: assistantContent,
        role: 'assistant',
        authorId: 'clauterion-claude',
        createdAt: FieldValue.serverTimestamp(),
    });
    return {
        messageId: assistantMessageRef.id,
        content: assistantContent,
    };
});
