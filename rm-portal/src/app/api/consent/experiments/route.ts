import { query } from "@/lib/db"
import { withDb, getJsonBody, badRequest, audit } from "@/lib/consent-helpers"
import type { RewardMetric } from "@/lib/consent"

const VALID_METRICS: RewardMetric[] = [
  "response_helpfulness", "customer_satisfaction", "booking_completion",
  "retention", "reduced_support_time", "response_rate",
]

export async function GET() {
  return withDb(async () => {
    const result = await query(
      `SELECT e.*, 
        COALESCE(json_agg(
          json_build_object(
            'id', v.id, 'label', v.label, 'content', v.content,
            'impressions', v.impressions, 'responses', v.responses,
            'reward_sum', v.reward_sum, 'created_at', v.created_at
          )
        ) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
       FROM experiments e
       LEFT JOIN experiment_variants v ON v.experiment_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC`
    )
    return Response.json(result.rows)
  })
}

export async function POST(request: Request) {
  return withDb(async () => {
    const body = await getJsonBody(request)
    const name = (body.name as string || "").trim()
    const rewardMetric = body.reward_metric as RewardMetric
    const description = (body.description as string) || null

    if (!name) return badRequest("name is required")
    if (!rewardMetric || !VALID_METRICS.includes(rewardMetric)) {
      return badRequest(`reward_metric must be one of: ${VALID_METRICS.join(", ")}`)
    }

    // Audience filter — HARD CONSTRAINT: experiments may only run on
    // contacts with active consent. consent_status is forced to "active"
    // and cannot be overridden by the caller.
    const userFilter = (body.audience_filter as Record<string, unknown>) || {}
    // Reject any attempt to bypass consent requirement
    if (userFilter.consent_status && userFilter.consent_status !== "active") {
      return badRequest("consent_status cannot be overridden — experiments are restricted to consenting populations (constraint 5)")
    }
    if (userFilter.require_consent === false || userFilter.require_consent === "false") {
      return badRequest("require_consent cannot be disabled — experiments must run on consenting audiences only (constraint 5)")
    }
    const audienceFilter = {
      ...userFilter,
      consent_status: "active",   // forced — cannot be overridden
      require_consent: true,       // forced — cannot be disabled
    }

    const result = await query(
      `INSERT INTO experiments (name, description, reward_metric, audience_filter)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, description, rewardMetric, JSON.stringify(audienceFilter)]
    )

    await audit("experiment_created", "experiment", result.rows[0].id as string, "api", { name, reward_metric: rewardMetric })
    return Response.json(result.rows[0], { status: 201 })
  })
}
