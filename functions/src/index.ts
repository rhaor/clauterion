import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { defineSecret } from 'firebase-functions/params'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getFirebaseApp } from './firebase.js'
import { createMessageSchema } from './schemas/message.js'

const claudeApiKey = defineSecret('CLAUDE_API_KEY')

const app = getFirebaseApp()
const db = getFirestore(app)

export const createAssistantMessage = onCall(
  {
    cors: true,
    region: 'us-central1',
    secrets: [claudeApiKey],
  },
  async (request) => {
    try {
      const { auth, data } = request

      if (!auth) {
        throw new HttpsError('unauthenticated', 'Sign in to call this function')
      }

      const parsed = createMessageSchema.safeParse(data)
      if (!parsed.success) {
        throw new HttpsError('invalid-argument', parsed.error.message)
      }

      const { topicId, content } = parsed.data

      const topicRef = db.collection('topics').doc(topicId)
      const topicSnapshot = await topicRef.get()

      if (!topicSnapshot.exists) {
        throw new HttpsError('not-found', 'Topic not found')
      }

      if (topicSnapshot.data()?.ownerId !== auth.uid) {
        throw new HttpsError('permission-denied', 'You do not own this topic')
      }

      // Collect prior thread for context (lightly capped to avoid token bloat).
      const historySnapshot = await topicRef
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .limit(30)
        .get()

      const historyMessages =
        historySnapshot.docs
          .map((doc) => doc.data())
          .filter((msg) => typeof msg.content === 'string' && typeof msg.role === 'string')
          .map((msg) => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content as string,
          })) ?? []

      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': claudeApiKey.value(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          // Sonnet 3.5 stable; adjust if you prefer a newer dated release.
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 512,
          messages: [
            ...historyMessages.map((msg) => ({
              role: msg.role,
              content: [{ type: 'text', text: msg.content }],
            })),
            { role: 'user', content: [{ type: 'text', text: content }] },
          ],
        }),
      })

      if (!anthropicResponse.ok) {
        const errorText = await anthropicResponse.text()
        const status = anthropicResponse.status
        // Map some common HTTP statuses to clearer function errors.
        if (status === 401 || status === 403) {
          throw new HttpsError('permission-denied', 'Claude API key invalid or unauthorized')
        }
        if (status === 429) {
          throw new HttpsError('resource-exhausted', 'Claude rate limit hit')
        }
        if (status >= 500) {
          throw new HttpsError('unavailable', 'Claude service unavailable')
        }
        throw new HttpsError('internal', `Claude API error (${status}): ${errorText}`)
      }

      const responseData = (await anthropicResponse.json()) as {
        content: { type: string; text?: string }[]
      }

      const textPart = responseData.content.find((part) => part.type === 'text')
      const assistantContent =
        textPart && 'text' in textPart && textPart.text
          ? textPart.text
          : '[Claude] No text content returned from API.'

      const assistantMessageRef = topicRef.collection('messages').doc()

      await assistantMessageRef.set({
        content: assistantContent,
        role: 'assistant',
        authorId: 'clauterion-claude',
        createdAt: FieldValue.serverTimestamp(),
      })

      return {
        messageId: assistantMessageRef.id,
        content: assistantContent,
      }
    } catch (error) {
      logger.error('createAssistantMessage failed', error)

      // Map common Anthropic / network errors to clearer HttpsErrors.
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('invalid_api_key') || message.includes('Unauthorized')) {
        throw new HttpsError('permission-denied', 'Claude API key invalid')
      }
      if (message.toLowerCase().includes('rate limit')) {
        throw new HttpsError('resource-exhausted', 'Claude rate limit hit')
      }
      if (message.toLowerCase().includes('timeout')) {
        throw new HttpsError('deadline-exceeded', 'Claude request timed out')
      }
      if (error instanceof HttpsError) {
        throw error
      }
      throw new HttpsError('internal', message)
    }
  },
)

