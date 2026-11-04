import type { AssetContent, Submission } from "./domain";
import { currentVersion } from "./domain";
import { generationPrompt, type CheckReport } from "./checker";
import { fixes } from "./seed";

export type SuggestedGeneration = {
  content: AssetContent;
  prompt: string;
  kind: "text" | "image";
};

// Two transparent prepared outputs. Each request retains its actual source and approved feedback.
export async function generateSuggestedFix(
  item: Submission,
  report: CheckReport,
  feedback: string,
): Promise<SuggestedGeneration> {
  if (!report.canSuggestFix || !feedback.trim() || !item.fixture)
    throw new Error(
      "This submission needs a marketing revision; no prepared generation is available.",
    );
  const prompt = generationPrompt(item, report, feedback);
  const kind = item.fixture === "mortgage" ? "image" : "text";
  const content = {
    ...currentVersion(item).content,
    ...fixes[item.fixture].content,
    palette: "brand" as const,
  };
  if (kind === "image") {
    content.image = "creative/mortgage-fixed.png";
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}${content.image}`;
    await image.decode();
  }
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  return { content, prompt, kind };
}
