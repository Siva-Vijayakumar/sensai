"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function generateQuiz() {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await db.user.findUnique({
    where: {
      clerkUserId: userId,
    },
    select: {
      industry: true,
      skills: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const prompt = `
Generate 10 technical interview questions for a ${
    user.industry
  } professional${
    user.skills?.length
      ? ` with expertise in ${user.skills.join(", ")}`
      : ""
  }.

Each question should be multiple choice with 4 options.

Return the response ONLY in this JSON format:

{
  "questions": [
    {
      "question": "string",
      "options": [
        "string",
        "string",
        "string",
        "string"
      ],
      "correctAnswer": "string",
      "explanation": "string"
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON
- No markdown
- No explanations outside JSON
`;

  try {
    const completion =
      await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
      });

    const text =
      completion.choices[0]?.message?.content || "";

    const cleanedText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const quiz = JSON.parse(cleanedText);

    return quiz.questions;
  } catch (error) {
    console.error("Error generating quiz:", error);

    throw new Error("Failed to generate quiz questions");
  }
}

export async function saveQuizResult(
  questions,
  answers,
  score
) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await db.user.findUnique({
    where: {
      clerkUserId: userId,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const questionResults = questions.map(
    (q, index) => ({
      question: q.question,
      answer: q.correctAnswer,
      userAnswer: answers[index],
      isCorrect:
        q.correctAnswer === answers[index],
      explanation: q.explanation,
    })
  );

  const wrongAnswers = questionResults.filter(
    (q) => !q.isCorrect
  );

  let improvementTip = null;

  if (wrongAnswers.length > 0) {
    const wrongQuestionsText = wrongAnswers
      .map(
        (q) =>
          `Question: "${q.question}"
Correct Answer: "${q.answer}"
User Answer: "${q.userAnswer}"`
      )
      .join("\n\n");

    const improvementPrompt = `
The user got the following ${
      user.industry
    } technical interview questions wrong:

${wrongQuestionsText}

Based on these mistakes, provide a concise and specific improvement tip.

Requirements:
- Keep response under 2 sentences
- Be encouraging
- Focus on what to learn and practice
- Do not explicitly mention mistakes
`;

    try {
      const completion =
        await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "user",
              content: improvementPrompt,
            },
          ],
          temperature: 0.7,
        });

      improvementTip =
        completion.choices[0]?.message?.content?.trim() ||
        null;

      console.log(improvementTip);
    } catch (error) {
      console.error(
        "Error generating improvement tip:",
        error
      );
    }
  }

  try {
    const assessment =
      await db.assessment.create({
        data: {
          userId: user.id,
          quizScore: score,
          questions: questionResults,
          category: "Technical",
          improvementTip,
        },
      });

    return assessment;
  } catch (error) {
    console.error(
      "Error saving quiz result:",
      error
    );

    throw new Error("Failed to save quiz result");
  }
}

export async function getAssessments() {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await db.user.findUnique({
    where: {
      clerkUserId: userId,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  try {
    const assessments =
      await db.assessment.findMany({
        where: {
          userId: user.id,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

    return assessments;
  } catch (error) {
    console.error(
      "Error fetching assessments:",
      error
    );

    throw new Error("Failed to fetch assessments");
  }
}