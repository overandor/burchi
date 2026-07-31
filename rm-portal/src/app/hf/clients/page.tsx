"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Users, Star, MapPin, MessageSquare } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function HfClientsPage() {
  const { data, loading } = useApi<any[]>(() => api.hfClients(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading clients..." />

  const clients = data
  const total = counts?._count_clients ?? clients.length
  const totalReviews = clients.reduce((s: number, c: any) => s + (c.review_count || 0), 0)
  const totalMasseurs = clients.reduce((s: number, c: any) => s + (c.masseurs_reviewed || 0), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Profiles"
        subtitle="Users who leave reviews — their activity, reach, and masseurs reviewed"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Users} value={total} label="Total Clients" color="text-blue-400" />
        <StatCard icon={Star} value={totalReviews} label="Total Reviews" color="text-amber-400" />
        <StatCard icon={MapPin} value={clients.length} label="Loaded" color="text-purple-400" />
        <StatCard icon={MessageSquare} value={totalMasseurs} label="Masseurs Reviewed" color="text-emerald-400" />
      </div>

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Client Roster</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Username</TableHead>
                <TableHead className="text-zinc-500">Reviews</TableHead>
                <TableHead className="text-zinc-500">Cities Found</TableHead>
                <TableHead className="text-zinc-500">Masseurs Reviewed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c: any, i: number) => (
                <TableRow key={`${c.username}-${i}`} className="border-zinc-800/50">
                  <TableCell className="font-medium text-white">{c.username ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-zinc-300">{c.review_count ?? 0}</TableCell>
                  <TableCell className="tabular-nums text-zinc-400">{c.cities_found ?? 0}</TableCell>
                  <TableCell className="tabular-nums text-zinc-400">{c.masseurs_reviewed ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
