import { db } from "@/lib/prisma";
import { inngest } from "./client";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const generateIndustryInsights = inngest.createFunction(
  { name: "Generate Industry Insights" },
  { cron: "0 0 * * 0" },

  async ({ step }) => {
    const industries = await step.run("Fetch industries", async () => {
      return await db.industryInsight.findMany({
        select: { industry: true },
      });
    });

    for (const { industry } of industries) {
      const prompt = `
Analyze the current state of the ${industry} industry and provide insights in ONLY the following JSON format:

{
  "salaryRanges": [
    {
      "role": "string",
      "min": number,
      "max": number,
      "median": number,
      "location": "string"
    }
  ],
  "growthRate": number,
  "demandLevel": "HIGH" | "MEDIUM" | "LOW",
  "topSkills": ["skill1", "skill2"],
  "marketOutlook": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "keyTrends": ["trend1", "trend2"],
  "recommendedSkills": ["skill1", "skill2"]
}

IMPORTANT:
- Return ONLY valid JSON
- No markdown
- No explanations
- Include at least 5 salary roles
`;

      try {
        const completion = await step.run(
          `Generate insights for ${industry}`,
          async () => {
            return await groq.chat.completions.create({
              model: "llama-3.3-70b-versatile",
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
              temperature: 0.7,
            });
          }
        );

        const text =
          completion.choices[0]?.message?.content || "";

        const cleanedText = text
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();

        const insights = JSON.parse(cleanedText);

        await step.run(`Update ${industry} insights`, async () => {
          await db.industryInsight.update({
            where: { industry },
            data: {
              ...insights,
              lastUpdated: new Date(),
              nextUpdate: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000
              ),
            },
          });
        });

        // Prevent rate limits
        await new Promise((resolve) =>
          setTimeout(resolve, 2000)
        );
      } catch (error) {
        console.error(
          `Error processing ${industry}:`,
          error.message
        );
      }
    }
  }
);