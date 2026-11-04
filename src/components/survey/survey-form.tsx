"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_FEEDBACK_LENGTH, SURVEYS, type AnswerKey, type SurveyType } from "@/lib/survey/definitions";
import { NpsScale } from "./nps-scale";
import { EmojiScale } from "./emoji-scale";
import { StarRating } from "./star-rating";
import { ReasonSelect } from "./reason-select";
import { submitSurveyAction } from "@/app/survey/[token]/actions";

type Answers = Partial<Record<AnswerKey, number | string>> & { other_reason_description?: string };

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "This survey link is not valid.",
  expired: "Sorry, this survey link has expired.",
  already_submitted: "This survey has already been completed. Thank you!",
  invalid_answers: "Some answers need attention. Please review your responses.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  unavailable: "We couldn't save your response right now. Please try again shortly.",
};

export function SurveyForm({ token, surveyType, preview = false }: { token: string; surveyType: SurveyType; preview?: boolean }) {
  const questions = SURVEYS[surveyType];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const headingId = useId();

  const q = questions[step];
  const isLast = step === questions.length - 1;
  const progress = ((step + 1) / questions.length) * 100;

  const stepError = useMemo(() => {
    if (!q.required) return null;
    const v = answers[q.key];
    if (v === undefined || v === "") return "Please choose an answer to continue.";
    if (q.key === "non_purchase_reason" && v === "other" && !answers.other_reason_description?.trim()) {
      return "Please tell us the reason.";
    }
    return null;
  }, [answers, q]);

  const [showError, setShowError] = useState(false);

  function set<K extends keyof Answers>(key: K, value: Answers[K]) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setShowError(false);
    setError(null);
  }

  function next() {
    if (stepError) {
      setShowError(true);
      return;
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, questions.length - 1));
    setShowError(false);
  }

  function back() {
    setDirection(-1);
    setStep((s) => Math.max(0, s - 1));
    setShowError(false);
    setError(null);
  }

  function submit() {
    if (submitted || pending) return;
    const firstInvalid = questions.findIndex((qq) => qq.required && (answers[qq.key] === undefined || answers[qq.key] === ""));
    if (firstInvalid !== -1) {
      setStep(firstInvalid);
      setShowError(true);
      return;
    }
    if (stepError) {
      setShowError(true);
      return;
    }
    setError(null);
    if (preview) {
      setSubmitted(true);
      router.push("/survey/thank-you?preview=1");
      return;
    }
    startTransition(async () => {
      const payload: Record<string, unknown> = {};
      for (const qq of questions) if (answers[qq.key] !== undefined) payload[qq.key] = answers[qq.key];
      if (surveyType === "non_purchased" && answers.non_purchase_reason === "other") payload.other_reason_description = answers.other_reason_description ?? "";
      const res = await submitSurveyAction(token, payload);
      if (res.ok || res.error === "already_submitted") {
        setSubmitted(true);
        router.replace(res.ok ? "/survey/thank-you" : "/survey/thank-you?already=1");
        return;
      }
      setError(ERROR_MESSAGES[res.error] ?? ERROR_MESSAGES.unavailable);
    });
  }

  const textValue = (answers[q.key] as string | undefined) ?? "";

  return (
    <div>
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">
            Question {step + 1} of {questions.length}
          </span>
          {!q.required && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Optional</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={questions.length} aria-valuenow={step + 1} aria-label="Survey progress">
          <div className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div key={step} className={cn("animate-in fade-in duration-300", direction === 1 ? "slide-in-from-right-4" : "slide-in-from-left-4")}>
        <h2 id={headingId} className="mb-6 text-lg font-semibold leading-snug text-foreground sm:text-xl">
          {q.text}
          {q.required && <span className="sr-only"> (required)</span>}
        </h2>

        {q.kind === "nps" && <NpsScale value={answers[q.key] as number | undefined} onChange={(v) => set(q.key, v)} labelledBy={headingId} />}
        {q.kind === "emoji" && q.options && (
          <EmojiScale options={q.options} value={answers[q.key] as number | undefined} onChange={(v) => set(q.key, v)} labelledBy={headingId} />
        )}
        {q.kind === "stars" && q.options && (
          <StarRating options={q.options} value={answers[q.key] as number | undefined} onChange={(v) => set(q.key, v)} labelledBy={headingId} />
        )}
        {q.kind === "single_select" && (
          <ReasonSelect
            value={answers.non_purchase_reason as string | undefined}
            other={answers.other_reason_description ?? ""}
            onChange={(v) => set("non_purchase_reason", v)}
            onOtherChange={(v) => set("other_reason_description", v)}
            labelledBy={headingId}
            otherError={showError && answers.non_purchase_reason === "other" && !answers.other_reason_description?.trim() ? "Please tell us the reason." : undefined}
          />
        )}
        {q.kind === "text" && (
          <div className="space-y-1.5">
            <textarea
              aria-labelledby={headingId}
              value={textValue}
              maxLength={MAX_FEEDBACK_LENGTH}
              onChange={(e) => set(q.key, e.target.value)}
              rows={5}
              placeholder={q.placeholder}
              className="w-full resize-y rounded-xl border border-input bg-white px-4 py-3 text-base outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm"
            />
            <p className="text-right text-xs text-muted-foreground tabular">
              {textValue.length} / {MAX_FEEDBACK_LENGTH}
            </p>
          </div>
        )}

        {showError && stepError && q.kind !== "single_select" && (
          <p role="alert" className="mt-4 text-sm font-medium text-destructive">
            {stepError}
          </p>
        )}
        {showError && stepError && q.kind === "single_select" && answers.non_purchase_reason === undefined && (
          <p role="alert" className="mt-4 text-sm font-medium text-destructive">
            {stepError}
          </p>
        )}
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
        <Button type="button" variant="ghost" size="lg" onClick={back} disabled={step === 0 || pending} className="h-11 px-4">
          <ArrowLeft data-icon="inline-start" /> Previous
        </Button>
        {isLast ? (
          <Button type="button" size="lg" onClick={submit} disabled={pending || submitted} className="h-11 min-w-36 bg-brand px-5 text-brand-foreground hover:bg-brand/90">
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
            {pending ? "Submitting…" : "Submit feedback"}
          </Button>
        ) : (
          <Button type="button" size="lg" onClick={next} className="h-11 min-w-28 bg-brand px-5 text-brand-foreground hover:bg-brand/90">
            Next <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}
