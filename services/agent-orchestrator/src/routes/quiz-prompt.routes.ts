import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { quizPromptService } from '../services/quiz-prompt.service';

const router = Router();

// Validation schema
const quizAnswersSchema = z.object({
    role: z.enum(['sales', 'lead_qualification', 'support', 'info_consultant']),

    // Sales-specific
    salesCta: z.enum(['meeting', 'payment', 'phone', 'custom']).optional(),
    salesCtaCustom: z.string().optional(),
    salesPersistence: z.enum(['aggressive', 'consultative', 'passive', 'custom']).optional(),
    salesPersistenceCustom: z.string().optional(),

    // Lead qualification
    leadFilter: z.enum(['vacuum', 'sniper', 'custom']).optional(),
    leadFilterCustom: z.string().optional(),
    leadStrategy: z.enum(['native', 'survey', 'custom']).optional(),
    leadStrategyCustom: z.string().optional(),
    surveyQuestions: z.array(z.string()).optional(),

    // Support
    supportEmpathy: z.enum(['maximum', 'professional', 'custom']).optional(),
    supportEmpathyCustom: z.string().optional(),
    supportLanguage: z.enum(['beginner', 'expert', 'custom']).optional(),
    supportLanguageCustom: z.string().optional(),

    // Info consultant
    infoInterpretation: z.enum(['strict', 'analyst', 'custom']).optional(),
    infoInterpretationCustom: z.string().optional(),
    infoOfftopic: z.enum(['ignore', 'polite', 'custom']).optional(),
    infoOfftopicCustom: z.string().optional(),

    // Global settings
    toneOfVoice: z.enum(['official', 'friendly', 'casual', 'custom']).optional(),
    toneOfVoiceCustom: z.string().optional(),
    responseLength: z.enum(['concise', 'balanced', 'detailed', 'custom']).optional(),
    responseLengthCustom: z.string().optional(),
    fallback: z.enum(['admit', 'contact', 'guess', 'custom']).optional(),
    fallbackCustom: z.string().optional(),

    // Constraints
    constraints: z.array(z.enum(['no_swearing', 'no_prices', 'no_competitors', 'no_hallucination'])).optional(),
    customConstraints: z.array(z.string()).optional(),
});

const generatePromptSchema = z.object({
    userId: z.string().min(1),
    agentName: z.string().min(1),
    agentDescription: z.string().min(1),
    quizAnswers: quizAnswersSchema,
});

// POST /api/v1/generate-agent-prompt-from-quiz
router.post('/generate-agent-prompt-from-quiz', async (req: Request, res: Response) => {
    try {
        const parsed = generatePromptSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const systemPrompt = await quizPromptService.generatePrompt(parsed.data);

        return res.json({
            success: true,
            systemPrompt,
        });
    } catch (error: any) {
        console.error('Generate prompt from quiz error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate prompt',
            message: error.message,
        });
    }
});

export default router;
