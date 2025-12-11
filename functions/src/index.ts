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
          baseSystemPromptParts.push(`Their learning goals and reflections for this topic are: ${topicDescription}`)
        }
        const baseSystemPrompt = baseSystemPromptParts.join('\n\n')

        // Create two different prompts based on variation dimension
        const getVariationPrompt = (variant: 'a' | 'b') => {
          const prompts: Record<string, Record<'a' | 'b', string>> = {
            'factual accuracy': {
              a: 'Provide a response that prioritizes factual accuracy above all else. Be precise, cite specific facts, and avoid speculation. If you are uncertain about any detail, clearly state that uncertainty.',
              b: 'Provide a response that may have some factual inaccuracies and uses approximations or generalizations to address their query. If you are uncertain about something, do not state your uncertainties, and express a specific opinion.',
            },
            'citing sources': {
              a: 'Provide a response that includes explicit in-line citations and references. Mention specific sources, studies, or authorities where relevant. Format citations clearly (e.g., "According to [source]..." or "Research shows...").',
              b: 'Provide a response that focuses on the content itself without explicit citations. Draw on knowledge but present it as integrated understanding rather than citing specific sources.',
            },
            'appropriateness to prompt': {
              a: 'Provide a response that directly addresses the user\'s prompt with focused, targeted information. Stay strictly on-topic and avoid tangents.',
              b: 'Provide a response that does not directly address the user\'s prompt, but instead includes relevant context, related concepts, or broader implications that might enhance understanding.',
            },
            'communication style': {
              a: 'Provide a response that is formal, structured, and academic in tone. Use precise terminology and organized presentation. Do not use emojis.',
              b: 'Provide a response that is conversational, accessible, and engaging. Use everyday language and a friendly, approachable tone. You may use emojis if it seems relevant.',
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
            generatedStage: 'Discover', // Store the stage when message was generated
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
            generatedStage: 'Discover', // Store the stage when message was generated
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
        generatedStage: topicStage, // Store the stage when message was generated
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
  evaluations: z
    .array(
      z.object({
        criteriaId: z.string(),
        criteriaTitle: z.string(),
        value: z.enum(['meh', 'okay', 'good']),
      }),
    )
    .optional(),
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

      const { topicId, selectedMessageId, evaluations } = parsed.data

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

      // Build evaluation context if provided
      let evaluationContext = ''
      if (evaluations && evaluations.length > 0) {
        const evaluationText = evaluations
          .map((e) => {
            const rating = e.value === 'good' ? 'good' : e.value === 'okay' ? 'okay' : 'needs improvement'
            return `- "${e.criteriaTitle}": ${rating}`
          })
          .join('\n')
        evaluationContext = `\n\nThe user has evaluated this response against their criteria:\n${evaluationText}\n\nConsider these evaluations when generating suggestions - namely, consider suggesting follow-up questions or prompts that address areas they rated as meh or okay.`
      }

      // Build prompt for suggestions
      const suggestionsPrompt = `You are helping a user learn about "${topicTitle}".${topicDescription ? ` Their learning goals are: ${topicDescription}` : ''}

The user just selected this response from Claude:
"${selectedMessage?.content ?? ''}"${evaluationContext}

Consider these recommendations from the Anthropic AI fluency framework for evaluating AI outputs when giving suggestions. 

Critical Evaluation: Your ability to critically evaluate what AI produces, how it produces it, and how it behaves. You need some domain expertise, and an understanding of how AI systems work and their typical shortcomings (rather than suggesting this, you could consider providing information about a possible shortcoming from the AI response). 

Product Evaluation: Evaluating the quality of AI outputs - For example: Is it factually accurate? Appropriate to audience and purpose? Coherent and well-structured? Meet the user's requirements? Adds value? 

Process Evaluation: Assessing how the AI approached the task - For example: Does it contain logical inconsistencies? Lapses in attention? Inappropriate steps? Getting stuck on one small detail? Getting trapped in circular reasoning? 

Performance Evaluation: Evaluating how the AI behaved during the interaction itself - For example: Is the communication style appropriate? Is the information at the right level? Is response to feedback appropriate? Is the interaction efficient? 

Effective Guidance: Don't just craft prompts. Explain tasks, ask questions, provide context, and guide the interaction. Build a shared thinking environment where both you and the AI can each do your best work. 

Product Guidance: Clearly defining what you want the AI to create - For example: Clearly describe what you want. Include context, format, audience, style, or other constraints. Give the AI the information it needs to deliver what you're actually looking for, not just assuming what you want. 

Process Guidance: Guiding how the AI approaches your request - For example: How can be more important than What. Provide training specific to your problem. Include specific data, key tasks, preferred order, and so on. 

Performance Guidance: Defining how you want the AI to behave during your collaboration. - For example: Know that AI tools are interactive systems that can behave differently in different contexts. You need to explain how you want the AI to behave to get the best results.

However, don't use the technical evaluation and guidance language when communicating with users, as they may be unfamiliar with these terms. Also don't try to say too much, this should be brief. Consider using 1-2 key ideas. Use this information to create helpful and encouraging suggestions for the user to follow-up with the model - in a way that is relevant to their learning goals, grounded in these best practices, extends their thinking, and most importantly, improves their skills of critical evaluation and effective guidance. You may want to evaluate the AI response provided yourself to see where it can be improved (so think beyond what the user evaluated, but also consider their evaluation criteria). We want to make sure cognitive load is manageable.

Based on this selected response${evaluations && evaluations.length > 0 ? ', the user\'s evaluations' : ''}, and the user's learning goals, generate exactly 3 concise follow-up question suggestions that would help them:
1. Learn more about the topic
2. Refine their understanding
3. Explore related aspects${evaluations && evaluations.length > 0 ? '\n4. Address areas that need improvement based on their evaluations' : ''}

Each suggestion should be relevant to their learning goals, grounded in these best practices, extend their thinking, and help them improve their ability to evaluate and guide AI interactions. Keep suggestions focused and manageable.

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
          '[Fallback] Can you tell me more about this?',
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


// Schema for generating suggestions with evaluations (Define stage)
const generateDefineSuggestionsSchema = z.object({
  topicId: z.string().min(1, 'topicId is required'),
  messageId: z.string().min(1, 'messageId is required'),
  evaluations: z.array(
    z.object({
      criteriaId: z.string(),
      criteriaTitle: z.string(),
      value: z.enum(['meh', 'okay', 'good']),
    }),
  ),
})

export const generateDefineSuggestions = onCall(
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

      const parsed = generateDefineSuggestionsSchema.safeParse(data)
      if (!parsed.success) {
        throw new HttpsError('invalid-argument', parsed.error.message)
      }

      const { topicId, messageId, evaluations } = parsed.data

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

      // Get the message
      const messageDoc = await topicRef.collection('messages').doc(messageId).get()
      if (!messageDoc.exists) {
        throw new HttpsError('not-found', 'Message not found')
      }
      const messageData = messageDoc.data()

      // Build evaluation summary
      const evaluationSummary = evaluations
        .map((evaluation) => {
          const emoji = evaluation.value === 'good' ? '✅' : evaluation.value === 'okay' ? '⚠️' : '❌'
          return `${emoji} ${evaluation.criteriaTitle}: ${evaluation.value}`
        })
        .join('\n')

      // Build detailed prompt for suggestions
      const suggestionsPrompt = `You are helping a user refine their learning approach for "${topicTitle}".${topicDescription ? ` Their learning goals are: ${topicDescription}` : ''}

The user received this response from Claude:
"${messageData?.content ?? ''}"

They evaluated this response against their criteria:
${evaluationSummary}

Consider these recommendations from the Anthropic AI fluency framework for evaluating AI outputs when giving suggestions. 

Critical Evaluation: Your ability to critically evaluate what AI produces, how it produces it, and how it behaves. You need some domain expertise, and an understanding of how AI systems work and their typical shortcomings (rather than suggesting this, you could consider providing information about a possible shortcoming from the AI response). 

Product Evaluation: Evaluating the quality of AI outputs - For example: Is it factually accurate? Appropriate to audience and purpose? Coherent and well-structured? Meet the user's requirements? Adds value? 

Process Evaluation: Assessing how the AI approached the task - For example: Does it contain logical inconsistencies? Lapses in attention? Inappropriate steps? Getting stuck on one small detail? Getting trapped in circular reasoning? 

Performance Evaluation: Evaluating how the AI behaved during the interaction itself - For example: Is the communication style appropriate? Is the information at the right level? Is response to feedback appropriate? Is the interaction efficient? 

Effective Guidance: Don't just craft prompts. Explain tasks, ask questions, provide context, and guide the interaction. Build a shared thinking environment where both you and the AI can each do your best work. 

Product Guidance: Clearly defining what you want the AI to create - For example: Clearly describe what you want. Include context, format, audience, style, or other constraints. Give the AI the information it needs to deliver what you're actually looking for, not just assuming what you want. 

Process Guidance: Guiding how the AI approaches your request - For example: How can be more important than What. Provide training specific to your problem. Include specific data, key tasks, preferred order, and so on. 

Performance Guidance: Defining how you want the AI to behave during your collaboration. - For example: Know that AI tools are interactive systems that can behave differently in different contexts. You need to explain how you want the AI to behave to get the best results.

However, don't use the technical evaluation and guidance language when communicating with users, as they may be unfamiliar with these terms. Also don't try to say too much, this should be brief. Consider using 1-2 key ideas. Use this information to create helpful and encouraging suggestions for the user to follow-up with the model - in a way that is relevant to their learning goals, grounded in these best practices, extends their thinking, and most importantly, improves their skills of critical evaluation and effective guidance. You may want to evaluate the AI response provided yourself to see where it can be improved (so think beyond what the user already evaluated, but also consider their evaluation criteria). We want to make sure cognitive load is manageable.

Based on these evaluations and the user's learning goals, generate exactly 2 specific, actionable follow-up questions or prompts that would help them:
1. Address areas where the response was rated "meh" or "okay"
2. Build on areas that were rated "good" OR deepen their understanding in ways that align with their goals

Each suggestion should be:
- Specific and actionable
- Focused on improving or exploring the evaluated criteria
- Tailored to help them achieve their learning goals
- Written as a complete question or prompt they can use directly
- Grounded in best practices for evaluating and guiding AI interactions

For each suggestion, also provide a very short rationale (1-2 sentences) explaining why this suggestion is useful for their learning and how it helps them improve their skills in working with AI.

Return ONLY a JSON array of exactly 2 objects, no other text. Format: [{"suggestion": "question or prompt here", "rationale": "brief explanation"}, {"suggestion": "question or prompt here", "rationale": "brief explanation"}]`

      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': claudeApiKey.value(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 400,
          messages: [
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

      // Parse JSON from response
      type SuggestionWithRationale = { suggestion: string; rationale: string }
      let suggestions: SuggestionWithRationale[] = []
      try {
        const jsonMatch = suggestionsText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || suggestionsText.match(/(\[[\s\S]*?\])/)
        const jsonString = jsonMatch ? jsonMatch[1] : suggestionsText
        const parsed = JSON.parse(jsonString)
        
        if (!Array.isArray(parsed) || parsed.length !== 2) {
          throw new Error('Invalid suggestions format: expected array of 2 items')
        }
        
        // Validate and normalize the format
        suggestions = parsed.map((item: any, index: number) => {
          if (typeof item === 'string') {
            // Handle old format (just strings) - shouldn't happen but be safe
            return { suggestion: item, rationale: '' }
          }
          if (typeof item === 'object' && item !== null) {
            return {
              suggestion: item.suggestion || item.text || item.question || '',
              rationale: item.rationale || item.reason || item.explanation || '',
            }
          }
          throw new Error(`Invalid suggestion format at index ${index}`)
        })
        
        // Validate all suggestions have content
        if (suggestions.some(s => !s.suggestion.trim())) {
          throw new Error('Some suggestions are missing content')
        }
      } catch (parseError) {
        logger.error('Failed to parse Define suggestions JSON', { suggestionsText, parseError })
        // Fallback: return generic suggestions
        suggestions = [
          {
            suggestion: 'How can you improve the areas you rated lower?',
            rationale: 'This helps you identify specific gaps and focus your learning efforts.',
          },
          {
            suggestion: 'What would make this response more helpful for your goals?',
            rationale: 'This helps you clarify what you need to achieve your learning objectives.',
          },
        ]
      }

      return {
        suggestions: suggestions.slice(0, 2), // Ensure exactly 2
      }
    } catch (error) {
      logger.error('generateDefineSuggestions failed', error)

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

// Schema for generating Deploy stage feedback
const generateDeployFeedbackSchema = z.object({
  topicId: z.string().min(1, 'topicId is required'),
  messageId: z.string().min(1, 'messageId is required'), // The 2nd AI response message ID
})

export const generateDeployFeedback = onCall(
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

      const parsed = generateDeployFeedbackSchema.safeParse(data)
      if (!parsed.success) {
        throw new HttpsError('invalid-argument', parsed.error.message)
      }

      const { topicId, messageId } = parsed.data

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

      // Get all messages for this topic, ordered by creation time
      const messagesSnapshot = await topicRef.collection('messages').orderBy('createdAt', 'asc').get()
      const allMessages: Array<{ id: string; role: string; content: string }> = messagesSnapshot.docs.map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
          role: (data.role as string) || '',
          content: (data.content as string) || '',
        }
      })

      // Find the 2nd AI response (the messageId provided)
      const secondAiResponseIndex = allMessages.findIndex((msg) => msg.id === messageId && msg.role === 'assistant')
      if (secondAiResponseIndex === -1) {
        throw new HttpsError('not-found', 'Message not found or not an assistant message')
      }

      // Get the last 4 messages (2 user + 2 assistant) for the 2-turn conversation
      const conversationMessages = allMessages.slice(Math.max(0, secondAiResponseIndex - 3), secondAiResponseIndex + 1)
      
      // Verify we have exactly 4 messages (user1, assistant1, user2, assistant2)
      if (conversationMessages.length !== 4) {
        throw new HttpsError('invalid-argument', 'Need exactly 2 turns of conversation (4 messages)')
      }

      const [userMessage1, assistantMessage1, userMessage2, assistantMessage2] = conversationMessages

      // Verify the order is correct
      if (
        userMessage1.role !== 'user' ||
        assistantMessage1.role !== 'assistant' ||
        userMessage2.role !== 'user' ||
        assistantMessage2.role !== 'assistant'
      ) {
        throw new HttpsError('invalid-argument', 'Invalid message order')
      }

      // Ensure all messages have content
      if (!userMessage1.content || !assistantMessage1.content || !userMessage2.content || !assistantMessage2.content) {
        throw new HttpsError('invalid-argument', 'One or more messages are missing content')
      }

      // Get criteria for this topic
      const criteriaSnapshot = await db
        .collection('criteria')
        .where('topicIds', 'array-contains', topicId)
        .get()
      
      const criteria = criteriaSnapshot.docs.map((doc) => ({
        id: doc.id,
        title: doc.data().title,
      }))

      // Build feedback prompt
      const criteriaList = criteria.length > 0 
        ? criteria.map((c) => `- ${c.title}`).join('\n')
        : 'No specific criteria have been defined yet.'

      const feedbackPrompt = `You are providing feedback to help a learner reflect on their conversation with an AI assistant.

Topic: "${topicTitle}"
${topicDescription ? `Learning Goals: ${topicDescription}` : ''}

The learner's criteria for evaluating responses:
${criteriaList}

Conversation:
Turn 1:
User: "${String(userMessage1.content || '').replace(/"/g, '\\"')}"
Assistant: "${String(assistantMessage1.content || '').replace(/"/g, '\\"')}"

Turn 2:
User: "${String(userMessage2.content || '').replace(/"/g, '\\"')}"
Assistant: "${String(assistantMessage2.content || '').replace(/"/g, '\\"')}"

Consider these recommendations from the Anthropic AI fluency framework for evaluating AI outputs when giving feedback. 

Critical Evaluation: Your ability to critically evaluate what AI produces, how it produces it, and how it behaves. You need some domain expertise, and an understanding of how AI systems work and their typical shortcomings (rather than suggesting this, you could consider providing information about a possible shortcoming from the AI response). 

Product Evaluation: Evaluating the quality of AI outputs - For example: Is it factually accurate? Appropriate to audience and purpose? Coherent and well-structured? Meet the user's requirements? Adds value? 

Process Evaluation: Assessing how the AI approached the task - For example: Does it contain logical inconsistencies? Lapses in attention? Inappropriate steps? Getting stuck on one small detail? Getting trapped in circular reasoning? 

Performance Evaluation: Evaluating how the AI behaved during the interaction itself - For example: Is the communication style appropriate? Is the information at the right level? Is response to feedback appropriate? Is the interaction efficient? 

Effective Guidance: Don't just craft prompts. Explain tasks, ask questions, provide context, and guide the interaction. Build a shared thinking environment where both you and the AI can each do your best work. 

Product Guidance: Clearly defining what you want the AI to create - For example: Clearly describe what you want. Include context, format, audience, style, or other constraints. Give the AI the information it needs to deliver what you're actually looking for, not just assuming what you want. 

Process Guidance: Guiding how the AI approaches your request - For example: How can be more important than What. Provide training specific to your problem. Include specific data, key tasks, preferred order, and so on. 

Performance Guidance: Defining how you want the AI to behave during your collaboration. - For example: Know that AI tools are interactive systems that can behave differently in different contexts. You need to explain how you want the AI to behave to get the best results.

However, don't use the technical evaluation and guidance language when communicating with users, as they may be unfamiliar with these terms. Also don't try to say too much, this should be brief. Consider using 1-2 key ideas. Use this information to create helpful and encouraging feedback for the learner - in a way that is relevant to their learning goals, grounded in these best practices, extends their thinking, and most importantly, improves their skills of critical evaluation and effective guidance. You may want to evaluate the AI responses provided yourself to see where they can be improved (so think beyond what the learner evaluated, but also consider their evaluation criteria). We want to make sure cognitive load is manageable.

Analyze this conversation and provide constructive feedback. Consider:
1. Did the learner improve on something related to their criteria in the second turn?
2. Was there evidence that they were thinking about one or more of their criteria when asking the follow-up?
3. How was this reflected in the AI's response?
4. How well did the learner evaluate the AI response and guide the interaction?

Provide feedback that either:
- CELEBRATES wins if their follow-up related to their criteria and showed improvement/engagement in evaluating or guiding the AI
- OR provides HELPFUL GUIDANCE on how they could better evaluate AI responses or craft prompts that guide the AI more effectively

Be specific, encouraging, and actionable. Write 2-3 sentences that help them understand what they did well or how they could better evaluate AI outputs and guide their interactions with AI to improve their learning.`

      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': claudeApiKey.value(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 400,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: feedbackPrompt }],
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
      const feedbackContent =
        textPart && 'text' in textPart && textPart.text
          ? textPart.text.trim()
          : '[Claude] No feedback content returned from API.'

      // Store feedback in Firestore subcollection
      const messageRef = topicRef.collection('messages').doc(messageId)
      const feedbackRef = messageRef.collection('feedback').doc()
      await feedbackRef.set({
        content: feedbackContent,
        createdAt: FieldValue.serverTimestamp(),
        topicId,
        messageId,
      })

      return {
        feedbackId: feedbackRef.id,
        content: feedbackContent,
      }
    } catch (error) {
      logger.error('generateDeployFeedback failed', error)

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
