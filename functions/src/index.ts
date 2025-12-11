import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { defineSecret } from 'firebase-functions/params'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { z } from 'zod'
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

      const topicData = topicSnapshot.data()
      if (topicData?.ownerId !== auth.uid) {
        throw new HttpsError('permission-denied', 'You do not own this topic')
      }

      const topicTitle = topicData?.title ?? 'this topic'
      const topicDescription = topicData?.description
      const topicStage = topicData?.stage ?? 'Discover'

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

      // Handle Discover stage with dual responses
      // Normalize stage comparison (handle undefined, null, or string variations)
      const normalizedStage = String(topicStage || 'Discover').trim()
      const isDiscoverStage = normalizedStage === 'Discover'
      
      logger.info('Stage check', {
        topicId,
        rawStage: topicData?.stage,
        topicStage,
        normalizedStage,
        isDiscoverStage,
        topicDataKeys: Object.keys(topicData || {}),
      })

      if (isDiscoverStage) {
        // Count user messages in Discover stage to determine query number
        const userMessagesInDiscover = historySnapshot.docs.filter(
          (doc) => doc.data().role === 'user' && !doc.data().discoverQueryNumber,
        ).length
        const queryNumber = userMessagesInDiscover + 1 // +1 for current message

        // Determine variation dimension based on query number
        const variationDimensions = [
          'factual accuracy',
          'citing sources',
          'appropriateness to prompt',
          'communication style',
        ]
        const dimensionIndex = Math.min(queryNumber - 1, variationDimensions.length - 1)
        const variationDimension = variationDimensions[dimensionIndex]

        // Build base system prompt
        const baseSystemPromptParts = [
          'You are a helpful AI assistant that helps users learn about new topics and explore ideas.',
          `The user is currently learning about: ${topicTitle}`,
        ]
        if (topicDescription) {
          baseSystemPromptParts.push(`Their learning goals for this topic are: ${topicDescription}`)
        }
        const baseSystemPrompt = baseSystemPromptParts.join('\n\n')

        // Create two different prompts based on variation dimension
        const getVariationPrompt = (variant: 'a' | 'b') => {
          const prompts: Record<string, Record<'a' | 'b', string>> = {
            'factual accuracy': {
              a: 'Provide a response that prioritizes factual accuracy above all else. Be precise, cite specific facts, and avoid speculation. If you are uncertain about any detail, clearly state that uncertainty.',
              b: 'Provide a response that balances factual accuracy with practical understanding. You may use approximations or general principles when exact facts are less critical to the user\'s learning goals.',
            },
            'citing sources': {
              a: 'Provide a response that includes explicit citations and references. Mention specific sources, studies, or authorities where relevant. Format citations clearly (e.g., "According to [source]..." or "Research shows...").',
              b: 'Provide a response that focuses on the content itself without explicit citations. Draw on knowledge but present it as integrated understanding rather than citing specific sources.',
            },
            'appropriateness to prompt': {
              a: 'Provide a response that directly addresses the user\'s prompt with focused, targeted information. Stay strictly on-topic and avoid tangents.',
              b: 'Provide a response that addresses the prompt but also includes relevant context, related concepts, or broader implications that might enhance understanding.',
            },
            'communication style': {
              a: 'Provide a response that is formal, structured, and academic in tone. Use precise terminology and organized presentation.',
              b: 'Provide a response that is conversational, accessible, and engaging. Use everyday language and a friendly, approachable tone.',
            },
          }
          return prompts[variationDimension]?.[variant] ?? 'Provide a helpful response.'
        }

        const systemPromptA = `${baseSystemPrompt}\n\n${getVariationPrompt('a')}`
        const systemPromptB = `${baseSystemPrompt}\n\n${getVariationPrompt('b')}`

        // Make two parallel Claude calls
        const [responseA, responseB] = await Promise.all([
          fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': claudeApiKey.value(),
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5-20250929',
              max_tokens: 512,
              system: systemPromptA,
              messages: [
                ...historyMessages.map((msg) => ({
                  role: msg.role,
                  content: [{ type: 'text', text: msg.content }],
                })),
                { role: 'user', content: [{ type: 'text', text: content }] },
              ],
            }),
          }),
          fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': claudeApiKey.value(),
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5-20250929',
              max_tokens: 512,
              system: systemPromptB,
              messages: [
                ...historyMessages.map((msg) => ({
                  role: msg.role,
                  content: [{ type: 'text', text: msg.content }],
                })),
                { role: 'user', content: [{ type: 'text', text: content }] },
              ],
            }),
          }),
        ])

        if (!responseA.ok || !responseB.ok) {
          const errorTextA = responseA.ok ? '' : await responseA.text()
          const errorTextB = responseB.ok ? '' : await responseB.text()
          const status = responseA.ok ? responseB.status : responseA.status
          if (status === 401 || status === 403) {
            throw new HttpsError('permission-denied', 'Claude API key invalid or unauthorized')
          }
          if (status === 429) {
            throw new HttpsError('resource-exhausted', 'Claude rate limit hit')
          }
          if (status >= 500) {
            throw new HttpsError('unavailable', 'Claude service unavailable')
          }
          throw new HttpsError('internal', `Claude API error (${status}): ${errorTextA || errorTextB}`)
        }

        const responseDataA = (await responseA.json()) as {
          content: { type: string; text?: string }[]
        }
        const responseDataB = (await responseB.json()) as {
          content: { type: string; text?: string }[]
        }

        const textPartA = responseDataA.content.find((part) => part.type === 'text')
        const textPartB = responseDataB.content.find((part) => part.type === 'text')

        const contentA =
          textPartA && 'text' in textPartA && textPartA.text
            ? textPartA.text
            : '[Claude] No text content returned from API.'
        const contentB =
          textPartB && 'text' in textPartB && textPartB.text
            ? textPartB.text
            : '[Claude] No text content returned from API.'

        // Store both responses with metadata
        const messageRefA = topicRef.collection('messages').doc()
        const messageRefB = topicRef.collection('messages').doc()

        await Promise.all([
          messageRefA.set({
            content: contentA,
            role: 'assistant',
            authorId: 'clauterion-claude',
            createdAt: FieldValue.serverTimestamp(),
            discoverVariant: 'a',
            discoverQueryNumber: queryNumber,
            discoverDimension: variationDimension,
            discoverPairId: messageRefA.id, // Use A's ID as pair identifier
          }),
          messageRefB.set({
            content: contentB,
            role: 'assistant',
            authorId: 'clauterion-claude',
            createdAt: FieldValue.serverTimestamp(),
            discoverVariant: 'b',
            discoverQueryNumber: queryNumber,
            discoverDimension: variationDimension,
            discoverPairId: messageRefA.id, // Same pair ID
          }),
        ])

        return {
          discoverMode: true,
          queryNumber,
          dimension: variationDimension,
          responses: [
            { messageId: messageRefA.id, content: contentA, variant: 'a' },
            { messageId: messageRefB.id, content: contentB, variant: 'b' },
          ],
        }
      }

      // Regular flow for Define and Deploy stages
      // Build system prompt incorporating topic context
      const systemPromptParts = [
        'You are a helpful AI assistant that helps users learn about new topics and explore ideas.',
        `The user is currently learning about: ${topicTitle}`,
      ]
      if (topicDescription) {
        systemPromptParts.push(`Their learning goals for this topic are: ${topicDescription}`)
      }
      systemPromptParts.push(
        'Provide clear, thoughtful explanations that help deepen understanding.',
        'Ask clarifying questions when helpful, break down complex concepts, and encourage exploration.',
        'Be conversational and supportive while maintaining accuracy.',
      )
      const systemPrompt = systemPromptParts.join('\n\n')

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
          system: systemPrompt,
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

// Schema for generating suggestions
const generateSuggestionsSchema = z.object({
  topicId: z.string().min(1, 'topicId is required'),
  selectedMessageId: z.string().min(1, 'selectedMessageId is required'),
})

export const generateSuggestions = onCall(
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

      const parsed = generateSuggestionsSchema.safeParse(data)
      if (!parsed.success) {
        throw new HttpsError('invalid-argument', parsed.error.message)
      }

      const { topicId, selectedMessageId } = parsed.data

      const topicRef = db.collection('topics').doc(topicId)
      const topicSnapshot = await topicRef.get()

      if (!topicSnapshot.exists) {
        throw new HttpsError('not-found', 'Topic not found')
      }

      const topicData = topicSnapshot.data()
      if (topicData?.ownerId !== auth.uid) {
        throw new HttpsError('permission-denied', 'You do not own this topic')
      }

      const topicTitle = topicData?.title ?? 'this topic'
      const topicDescription = topicData?.description

      // Get the selected message
      const selectedMessageDoc = await topicRef.collection('messages').doc(selectedMessageId).get()
      if (!selectedMessageDoc.exists) {
        throw new HttpsError('not-found', 'Selected message not found')
      }
      const selectedMessage = selectedMessageDoc.data()

      // Get conversation context
      const historySnapshot = await topicRef
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .limit(30)
        .get()

      const recentMessages = historySnapshot.docs
        .map((doc) => doc.data())
        .filter((msg) => typeof msg.content === 'string' && typeof msg.role === 'string')
        .slice(-5) // Last 5 messages for context

      // Build prompt for suggestions
      const suggestionsPrompt = `You are helping a user learn about "${topicTitle}".${topicDescription ? ` Their learning goals are: ${topicDescription}` : ''}

The user just selected this response from Claude:
"${selectedMessage?.content ?? ''}"

Based on this selected response and the user's learning goals, generate exactly 3 concise follow-up question suggestions that would help them:
1. Learn more about the topic
2. Refine their understanding
3. Explore related aspects

Return ONLY a JSON array of exactly 3 strings, no other text. Format: ["suggestion 1", "suggestion 2", "suggestion 3"]`

      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': claudeApiKey.value(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 300,
          messages: [
            ...recentMessages.map((msg) => ({
              role: msg.role === 'assistant' ? 'assistant' : 'user',
              content: [{ type: 'text', text: msg.content as string }],
            })),
            {
              role: 'user',
              content: [{ type: 'text', text: suggestionsPrompt }],
            },
          ],
        }),
      })

      if (!anthropicResponse.ok) {
        const errorText = await anthropicResponse.text()
        const status = anthropicResponse.status
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
      const suggestionsText =
        textPart && 'text' in textPart && textPart.text ? textPart.text.trim() : '[]'

      // Parse JSON from response (may be wrapped in markdown code blocks)
      let suggestions: string[] = []
      try {
        // Try to extract JSON from markdown code blocks if present
        const jsonMatch = suggestionsText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || suggestionsText.match(/(\[[\s\S]*?\])/)
        const jsonString = jsonMatch ? jsonMatch[1] : suggestionsText
        suggestions = JSON.parse(jsonString)
        if (!Array.isArray(suggestions) || suggestions.length !== 3) {
          throw new Error('Invalid suggestions format')
        }
      } catch (parseError) {
        logger.error('Failed to parse suggestions JSON', { suggestionsText, parseError })
        // Fallback: return generic suggestions
        suggestions = [
          'Can you tell me more about this?',
          'How does this relate to my goals?',
          'What are some practical applications?',
        ]
      }

      return {
        suggestions: suggestions.slice(0, 3), // Ensure exactly 3
      }
    } catch (error) {
      logger.error('generateSuggestions failed', error)

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

