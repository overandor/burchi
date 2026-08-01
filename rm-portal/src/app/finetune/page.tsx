"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Brain, Database, Zap, FlaskConical, Trophy, Play } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState, statusBadgeClass } from "@/components/ui-helpers"

export default function FinetunePage() {
  const { data: datasets, loading: dsLoading } = useApi<any[]>(() => api.finetuneListDatasets(), [], 30000)
  const { data: jobs, loading: jobsLoading } = useApi<any[]>(() => api.finetuneListJobs(), [], 30000)
  const { data: abTests, loading: abLoading } = useApi<any[]>(() => api.finetuneListABTests(), [], 30000)

  const [creating, setCreating] = useState(false)
  const [training, setTraining] = useState<string | null>(null)
  const [abTestResult, setAbTestResult] = useState<any>(null)
  const [runningAB, setRunningAB] = useState(false)

  // Dataset creation form
  const [dsName, setDsName] = useState("Bio Dataset")
  const [dsType, setDsType] = useState("bio")
  const [dsLimit, setDsLimit] = useState("50")

  // A/B test form
  const [abName, setAbName] = useState("Bio Quality Test")
  const [abPrompt, setAbPrompt] = useState("Write a professional massage therapist bio that attracts clients.")

  async function handleCreateDataset() {
    setCreating(true)
    await api.finetuneCreateDataset({
      name: dsName,
      content_type: dsType,
      limit: parseInt(dsLimit),
    })
    setCreating(false)
    window.location.reload()
  }

  async function handleTrain(jid: string) {
    setTraining(jid)
    await api.finetuneTrain(jid)
    setTraining(null)
    window.location.reload()
  }

  async function handleRunABTest() {
    setRunningAB(true)
    const result = await api.finetuneCreateABTest({
      name: abName,
      base_model: "qwen2-0.5b-q3k",
      finetuned_model: "qwen2-0.5b-q3k",
      prompt: abPrompt,
    })
    setAbTestResult(result)
    setRunningAB(false)
  }

  if (dsLoading) return <LoadingState label="Loading fine-tuning pipeline..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fine-Tuning Lab"
        subtitle="Train custom models on the platform's content corpus, deploy via HF Compiler, and A/B test content quality"
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Database} value={datasets?.length ?? 0} label="Datasets" color="text-blue-400" />
        <StatCard icon={Brain} value={jobs?.length ?? 0} label="Training Jobs" color="text-purple-400" />
        <StatCard icon={FlaskConical} value={abTests?.length ?? 0} label="A/B Tests" color="text-emerald-400" />
      </div>

      {/* Dataset Creation */}
      <SectionCard title="Create Training Dataset">
        <p className="text-sm text-muted-foreground mb-4">
          Collects training data from the platform's content corpus (successful bios, blogs, interviews, follow-ups).
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Dataset Name</label>
            <input
              value={dsName}
              onChange={(e) => setDsName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Content Type</label>
            <select
              value={dsType}
              onChange={(e) => setDsType(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="bio">Bios</option>
              <option value="blog">Blog Posts</option>
              <option value="interview">Interviews</option>
              <option value="followup">Follow-ups</option>
              <option value="all">All Content</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Sample Limit</label>
            <input
              value={dsLimit}
              onChange={(e) => setDsLimit(e.target.value)}
              type="number"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        </div>
        <Button onClick={handleCreateDataset} disabled={creating} className="mt-3" size="sm">
          {creating ? <Zap className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
          Create Dataset
        </Button>
      </SectionCard>

      {/* Datasets */}
      {datasets && datasets.length > 0 && (
        <SectionCard title="Datasets">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Name</TableHead>
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">Samples</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.map((ds: any) => (
                <TableRow key={ds.id} className="border-border">
                  <TableCell className="font-medium text-foreground">{ds.name}</TableCell>
                  <TableCell className="text-muted-foreground">{ds.content_type}</TableCell>
                  <TableCell className="text-muted-foreground">{ds.sample_count}</TableCell>
                  <TableCell><span className={statusBadgeClass(ds.status)}>{ds.status}</span></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(ds.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      {/* Training Jobs */}
      {jobs && jobs.length > 0 && (
        <SectionCard title="Training Jobs">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Model Name</TableHead>
                <TableHead className="text-muted-foreground">Base Model</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Progress</TableHead>
                <TableHead className="text-muted-foreground">Loss</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job: any) => (
                <TableRow key={job.id} className="border-border">
                  <TableCell className="font-medium text-foreground">{job.output_model_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{job.base_model}</TableCell>
                  <TableCell><span className={statusBadgeClass(job.status)}>{job.status}</span></TableCell>
                  <TableCell className="text-muted-foreground">{job.progress}%</TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.metrics ? JSON.parse(job.metrics).final_loss?.toFixed(4) : "—"}
                  </TableCell>
                  <TableCell>
                    {job.status === "pending" && (
                      <Button size="sm" variant="ghost" onClick={() => handleTrain(job.id)} disabled={training === job.id}>
                        {training === job.id ? <Zap className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                        Train
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      {/* A/B Testing */}
      <SectionCard title="A/B Test: Base vs Fine-Tuned Model">
        <p className="text-sm text-muted-foreground mb-4">
          Compare content quality between the base model and a fine-tuned model.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Test Name</label>
            <input
              value={abName}
              onChange={(e) => setAbName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Prompt</label>
            <textarea
              value={abPrompt}
              onChange={(e) => setAbPrompt(e.target.value)}
              className="w-full min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <Button onClick={handleRunABTest} disabled={runningAB} size="sm">
            {runningAB ? <Zap className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
            Run A/B Test
          </Button>
        </div>

        {abTestResult && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Base Model</span>
                <Badge variant="secondary" className="text-xs">Score: {abTestResult.base_score?.toFixed(2)}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">{abTestResult.base_output || "No output"}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Fine-Tuned</span>
                <Badge variant="secondary" className="text-xs">Score: {abTestResult.finetuned_score?.toFixed(2)}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">{abTestResult.finetuned_output || "No output"}</div>
            </div>
            <div className="col-span-2 flex items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <Trophy className="mr-2 h-4 w-4 text-amber-400" />
              <span className="text-sm font-medium">
                Winner: {abTestResult.winner === "tie" ? "Tie" : abTestResult.winner === "finetuned" ? "Fine-Tuned Model" : "Base Model"}
              </span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Previous A/B Tests */}
      {abTests && abTests.length > 0 && (
        <SectionCard title="Previous A/B Tests">
          <div className="space-y-2">
            {abTests.slice(0, 10).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                <span className="text-foreground">{t.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Base: {t.base_score?.toFixed(2)} vs FT: {t.finetuned_score?.toFixed(2)}</span>
                  <Badge variant={t.winner === "finetuned" ? "default" : "secondary"} className="text-xs">
                    {t.winner === "tie" ? "Tie" : t.winner === "finetuned" ? "FT Wins" : "Base Wins"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}
