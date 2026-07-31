"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Eye,
  Users,
  MousePointerClick,
  MessageSquare,
  CalendarCheck,
  DollarSign,
  Percent,
  Target,
  TrendingUp,
  LineChart as LineChartIcon,
} from "lucide-react"
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts"
import { useApi, api, type KpiSnapshot } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function KpiDashboardPage() {
  const { data: history, loading: historyLoading } = useApi<KpiSnapshot[]>(
    () => api.getKpis(30),
    []
  )
  const { data: latest, loading: latestLoading } = useApi<KpiSnapshot>(
    () => api.getLatestKpi(),
    [],
    15000
  )

  if (historyLoading && latestLoading) {
    return <LoadingState label="Loading KPI dashboard..." />
  }

  const kpis = history ?? []
  const latestKpi = latest
  const chartData = kpis
    .slice()
    .reverse()
    .map((k) => ({
      date: k.date.slice(5),
      impressions: k.impressions,
      visitors: k.visitors,
      clicks: k.clicks,
    }))

  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : n.toLocaleString()
  const fmtPct = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : `${n.toFixed(2)}%`
  const fmtMoney = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : `$${n.toLocaleString()}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="KPI Dashboard"
        subtitle="Revenue operations performance metrics — 30-day history with live snapshot"
      />

      {/* Latest snapshot stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={Eye}
          value={fmt(latestKpi?.impressions)}
          label="Impressions"
          color="text-blue-400"
        />
        <StatCard
          icon={Users}
          value={fmt(latestKpi?.visitors)}
          label="Visitors"
          color="text-cyan-400"
        />
        <StatCard
          icon={MousePointerClick}
          value={fmt(latestKpi?.clicks)}
          label="Clicks"
          color="text-purple-400"
        />
        <StatCard
          icon={MessageSquare}
          value={fmt(latestKpi?.contacts)}
          label="Contacts"
          color="text-amber-400"
        />
        <StatCard
          icon={CalendarCheck}
          value={fmt(latestKpi?.bookings)}
          label="Bookings"
          color="text-pink-400"
        />
        <StatCard
          icon={DollarSign}
          value={fmtMoney(latestKpi?.revenue)}
          label="Revenue"
          color="text-emerald-400"
        />
        <StatCard
          icon={Percent}
          value={fmtPct(latestKpi?.ctr)}
          label="CTR"
          color="text-orange-400"
        />
        <StatCard
          icon={Target}
          value={fmtPct(latestKpi?.conversion_rate)}
          label="Conversion Rate"
          color="text-red-400"
        />
      </div>

      {/* Trends chart */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingUp className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-white">KPI Trends</CardTitle>
          <Badge
            variant="outline"
            className="ml-auto border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[9px]"
          >
            30 DAYS
          </Badge>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="gImp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gVis" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gClk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#c084fc" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#c084fc" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <RTooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="impressions"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    fill="url(#gImp)"
                    name="Impressions"
                  />
                  <Area
                    type="monotone"
                    dataKey="visitors"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    fill="url(#gVis)"
                    name="Visitors"
                  />
                  <Area
                    type="monotone"
                    dataKey="clicks"
                    stroke="#c084fc"
                    strokeWidth={2}
                    fill="url(#gClk)"
                    name="Clicks"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No KPI history available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Line chart for finer trend comparison */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <LineChartIcon className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-white">Impression / Visitor / Click Lines</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <RTooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Line type="monotone" dataKey="impressions" stroke="#60a5fa" strokeWidth={2} dot={false} name="Impressions" />
                  <Line type="monotone" dataKey="visitors" stroke="#22d3ee" strokeWidth={2} dot={false} name="Visitors" />
                  <Line type="monotone" dataKey="clicks" stroke="#c084fc" strokeWidth={2} dot={false} name="Clicks" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No KPI history available
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI snapshots table */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-white">KPI Snapshots</CardTitle>
        </CardHeader>
        <CardContent>
          {kpis.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Date</TableHead>
                  <TableHead className="text-right text-zinc-400">Impressions</TableHead>
                  <TableHead className="text-right text-zinc-400">Visitors</TableHead>
                  <TableHead className="text-right text-zinc-400">Clicks</TableHead>
                  <TableHead className="text-right text-zinc-400">Contacts</TableHead>
                  <TableHead className="text-right text-zinc-400">Bookings</TableHead>
                  <TableHead className="text-right text-zinc-400">Revenue</TableHead>
                  <TableHead className="text-right text-zinc-400">CTR</TableHead>
                  <TableHead className="text-right text-zinc-400">Conv. Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpis.map((k) => (
                  <TableRow key={k.id ?? k.date} className="border-zinc-800/60">
                    <TableCell className="text-zinc-300 tabular-nums">{k.date}</TableCell>
                    <TableCell className="text-right text-white tabular-nums">{fmt(k.impressions)}</TableCell>
                    <TableCell className="text-right text-white tabular-nums">{fmt(k.visitors)}</TableCell>
                    <TableCell className="text-right text-white tabular-nums">{fmt(k.clicks)}</TableCell>
                    <TableCell className="text-right text-white tabular-nums">{fmt(k.contacts)}</TableCell>
                    <TableCell className="text-right text-white tabular-nums">{fmt(k.bookings)}</TableCell>
                    <TableCell className="text-right text-emerald-400 tabular-nums">{fmtMoney(k.revenue)}</TableCell>
                    <TableCell className="text-right text-zinc-300 tabular-nums">{fmtPct(k.ctr)}</TableCell>
                    <TableCell className="text-right text-zinc-300 tabular-nums">{fmtPct(k.conversion_rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No KPI snapshots available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
