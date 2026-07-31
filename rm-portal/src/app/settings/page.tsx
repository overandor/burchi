"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import {
  Settings,
  Database,
  Server,
  Zap,
  Sprout,
  Save,
  Info,
  CheckCircle2,
  Loader2,
} from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"
import { useState } from "react"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api (proxied)"

export default function SettingsPage() {
  const { data: controlState, loading, refetch } = useApi<Record<string, string>>(
    () => api.getControlState(),
    [],
    15000,
  )
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)

  const handleSeed = async () => {
    setSeeding(true)
    setSeedResult(null)
    const result = await api.seed()
    setSeeding(false)
    setSeedResult(result ? "Seed data created successfully" : "Seed failed — backend unreachable")
    await refetch()
    setTimeout(() => setSeedResult(null), 3000)
  }

  const handleSave = async (key: string) => {
    await api.setControlState(key, editValue)
    setEditingKey(null)
    setEditValue("")
    await refetch()
  }

  if (loading && !controlState) return <LoadingState label="Loading settings..." />

  const controlEntries = controlState ? Object.entries(controlState) : []

  return (
    <div className="space-y-6">
      <PageHeader title="System Settings" subtitle="Configuration, control state, and environment" />

      {/* System Configuration */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Server className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-white">System Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-blue-400" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">API Base URL</span>
              </div>
              <p className="mt-1.5 text-sm font-mono text-white">{API_BASE_URL}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-emerald-400" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Database Path</span>
              </div>
              <p className="mt-1.5 text-sm font-mono text-white">
                {controlState?.db_path || "data/revenue_ops.db"}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-orange-400" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Operating Mode</span>
              </div>
              <p className="mt-1.5 text-sm font-bold text-orange-400">
                {controlState?.mode?.toUpperCase() || "AUTO"}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-purple-400" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Scheduler Active</span>
              </div>
              <p className="mt-1.5 text-sm font-bold text-white">
                {controlState?.scheduler_active || "true"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seed Data */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Sprout className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-white">Data Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                <Sprout className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <span className="text-sm text-white">Seed Database</span>
                <p className="text-[10px] text-zinc-500">
                  Populate the database with initial demo data (experiments, visitors, telemetry)
                </p>
              </div>
            </div>
            <Button
              onClick={handleSeed}
              disabled={seeding}
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            >
              {seeding ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Seeding...
                </>
              ) : (
                <>
                  <Sprout className="mr-2 h-3.5 w-3.5" />
                  Seed Data
                </>
              )}
            </Button>
          </div>
          {seedResult && (
            <div
              className={`mt-3 flex items-center gap-2 rounded-lg border px-4 py-2 text-xs ${seedResult.includes("success")
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
                }`}
            >
              {seedResult.includes("success") ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Info className="h-3.5 w-3.5" />
              )}
              {seedResult}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Control State Table */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Settings className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-white">Control State</CardTitle>
          <span className="ml-auto text-[10px] text-zinc-500">{controlEntries.length} keys</span>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Key</TableHead>
                <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Value</TableHead>
                <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {controlEntries.map(([key, value]) => (
                <TableRow key={key} className="border-zinc-800/50">
                  <TableCell className="text-xs font-mono text-zinc-300">{key}</TableCell>
                  <TableCell>
                    {editingKey === key ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                        autoFocus
                      />
                    ) : (
                      <span className="text-xs font-mono text-white">{value}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editingKey === key ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 border-emerald-500/30 bg-emerald-500/10 px-2 text-[10px] text-emerald-400"
                          onClick={() => handleSave(key)}
                        >
                          <Save className="mr-1 h-3 w-3" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 border-zinc-700 px-2 text-[10px] text-zinc-400"
                          onClick={() => {
                            setEditingKey(null)
                            setEditValue("")
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px] text-zinc-400 hover:text-white"
                        onClick={() => {
                          setEditingKey(key)
                          setEditValue(value)
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Environment Info */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Info className="h-5 w-5 text-amber-400" />
          <CardTitle className="text-base text-white">Environment Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Next.js</span>
              <p className="text-sm font-bold text-white">16 (App Router)</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Framework</span>
              <p className="text-sm font-bold text-white">React 19</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Styling</span>
              <p className="text-sm font-bold text-white">Tailwind CSS v4</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">UI Library</span>
              <p className="text-sm font-bold text-white">shadcn/ui</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Icons</span>
              <p className="text-sm font-bold text-white">lucide-react</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Runtime</span>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
                CLIENT-SIDE
              </Badge>
            </div>
          </div>
          <Separator className="my-4 bg-zinc-800" />
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Info className="h-3.5 w-3.5" />
            Control state changes are sent via POST to <code className="text-zinc-400">/api/control/&#123;key&#125;</code>{" "}
            and take effect immediately.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
