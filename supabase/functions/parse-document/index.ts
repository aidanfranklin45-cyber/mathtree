// parse-document/index.ts
// Reads a document's text and returns the facts it states, in the intake schema. Nothing is written to any deal: the owner reviews the
// result first. Personal data (tenant names, phones, emails) is replaced with placeholders before the text leaves for the model, and the
// placeholders are swapped back in the answer. The model is reached only through Cloudflare AI Gateway (see _shared/aiGateway.ts).
//
// POST { text, filename?, documentType?, knownNames? }  (signed-in users only)
//   -> { documentType, classification, intake, redaction, model }

import { serve } from "std/http/server.ts";
import { getCaller } from "../_shared/auth.ts";
import { classifyDocument, CLEAR_ENOUGH } from "../_shared/documentTypes.ts";
import { redactForModel } from "../_shared/redact.ts";
import { GatewayError, gatewayConfigured, generateJson, modelName } from "../_shared/aiGateway.ts";
import {
  buildClassifyPrompt,
  buildExtractionPrompt,
  buildSystemPrompt,
  coerceIntake,
  isDocumentType,
  parseModelJson,
} from "../_shared/intakeParse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** About 35 pages of text. Larger files should be split by the owner rather than silently truncated. */
const MAX_CHARS = 150_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const startedAt = Date.now();
  const caller = await getCaller(req);
  if (!caller) return json({ error: "Sign in to read a document." }, 401);
  if (!gatewayConfigured()) return json({ error: "Document reading is not set up yet." }, 503);

  let body: { text?: unknown; filename?: unknown; documentType?: unknown; knownNames?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "The request was not valid JSON." }, 400);
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (text.trim().length < 20) return json({ error: "There is no text to read in that document." }, 400);
  if (text.length > MAX_CHARS) return json({ error: `That document is longer than ${MAX_CHARS.toLocaleString()} characters. Split it and read the parts separately.` }, 413);
  const filename = typeof body.filename === "string" ? body.filename.slice(0, 200) : undefined;
  const knownNames = Array.isArray(body.knownNames) ? body.knownNames.filter((n): n is string => typeof n === "string").slice(0, 500) : [];

  // Privacy first: nothing below this line sees the original text
  const redaction = redactForModel(text, { knownNames });

  try {
    // Which kind of document: the owner's choice, else the cheap keyword pass, else one short model call
    const classification = classifyDocument({ text: redaction.text, filename });
    let documentType = isDocumentType(body.documentType) ? body.documentType : classification.type;
    if (documentType === "unknown") {
      const answer = parseModelJson(await generateJson({ system: buildSystemPrompt(), user: buildClassifyPrompt(redaction.text), timeoutMs: 25_000 })) as { type?: unknown } | null;
      documentType = isDocumentType(answer?.type) ? answer!.type : "unknown";
    }
    if (documentType === "unknown") {
      return json({
        documentType,
        classification,
        intake: coerceIntake("unknown", null),
        redaction: redaction.report,
        model: modelName(),
        message: "I could not tell what kind of document this is. Choose the type and try again.",
      });
    }

    const ask = () => generateJson({ system: buildSystemPrompt(), user: buildExtractionPrompt(documentType, redaction.text) });
    let parsed = parseModelJson(await ask());
    // An answer that is not JSON is rare and usually does not repeat: ask once more if there is time left in the request
    if (parsed === null && Date.now() - startedAt < 60_000) parsed = parseModelJson(await ask());
    if (parsed === null) return json({ error: "The model's answer could not be read. Try again." }, 502);

    return json({
      documentType,
      classification: { ...classification, thresholds: CLEAR_ENOUGH },
      intake: coerceIntake(documentType, parsed, redaction.restore),
      redaction: redaction.report,
      model: modelName(),
    });
  } catch (e) {
    if (e instanceof GatewayError) return json({ error: e.message }, e.status);
    // Never include the error object: it can carry document text
    return json({ error: "Something went wrong reading that document." }, 500);
  }
}

serve(handleRequest);
