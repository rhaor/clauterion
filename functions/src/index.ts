import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore } from 'firebase-admin/firestore'
import { getFirebaseApp } from './firebase'
import { createMessageSchema } from './schemas/message'

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

    const assistantMessageRef = topicRef.collection('messages').doc()

    // Placeholder response so the prototype works end-to-end without Claude hooked up.
    const assistantContent = `[Claude placeholder] Echoing: ${content.slice(
      0,
      200,
    )}`

    await assistantMessageRef.set({
      content: assistantContent,
      role: 'assistant',
      authorId: 'clauterion-claude',
      createdAt: new Date(),
    })

    return {
      messageId: assistantMessageRef.id,
      content: assistantContent,
    }
  },
)

