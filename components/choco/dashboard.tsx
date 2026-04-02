"use client";

import { MetricCard } from "./metric-card";
import { MarketShareChart } from "./market-share-chart";
import { InteractiveDataGrid } from "./interactive-data-grid";
import { SWOTGrid } from "./swot-grid";
import { StrategicRoadmap } from "./strategic-roadmap";
import { AIRoadmap } from "./ai-roadmap";
import { motion } from "framer-motion";
import { ShieldAlert, Zap, TrendingUp, Lightbulb, Target, Sparkles, AlertCircle, TrendingDown, MoveRight } from "lucide-react";
import data from "@/lib/data/chocofamily.json"; 

export default function ChocoDashboard() {
  return (
    <div className="bg-[#111111] text-white p-6 md:p-12 font-sans selection:bg-[#E50000] selection:text-white space-y-16 max-w-[1440px] mx-auto">
      {/* Header */}
      <header className="border-b border-white/10 pb-12 flex flex-col md:flex-row items-center justify-between gap-8">
        <motion.div 
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex flex-col md:flex-row md:items-center gap-6"
        >
          <div className="w-16 h-16 bg-[#E50000] rounded-2xl flex items-center justify-center shadow-[0_0_40px_rgba(229,0,0,0.3)] group hover:scale-105 transition-transform cursor-pointer">
            <Target className="text-white group-hover:rotate-12 transition-transform" size={32} />
          </div>
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2 uppercase italic">
              Choco<span className="text-[#E50000]">Link</span> Strategic Hub
            </h1>
            <p className="text-gray-500 font-mono text-sm tracking-widest flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]"></span>
              STATUS: LIVE_STRATEGY_STREAM • 2026_Q2_DASHBOARD
            </p>
          </div>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-right flex flex-col gap-1"
        >
          <div className="flex items-center justify-end gap-3 text-xs font-black uppercase tracking-[0.3em] text-[#E50000]">
            <Sparkles size={14} />
            AI Analytics Verified
          </div>
          <p className="text-gray-500 text-sm font-medium">{data.clientProfile.industry}</p>
          <p className="text-[10px] text-gray-700 font-mono">{data.clientProfile.analyst} | CONFIDENCE: {data.clientProfile.confidence}</p>
        </motion.div>
      </header>

      {/* KPI Alpha Section */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
          {data.kpis.map((kpi, index) => (
            <MetricCard 
              key={index}
              title={kpi.metric}
              value={kpi.value}
              confidence={kpi.confidence}
              category={kpi.category}
              delay={index * 0.05}
            />
          ))}
        </div>
      </section>

      {/* Executive Callout: Threat vs Opportunity */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="p-10 rounded-[2.5rem] bg-gradient-to-br from-[#E50000]/10 to-transparent border border-[#E50000]/20 relative overflow-hidden group hover:from-[#E50000]/20 transition-all duration-500"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
            <AlertCircle size={120} className="text-[#E50000]" />
          </div>
          <h3 className="text-2xl font-black text-rose-500 mb-6 flex items-center gap-4 uppercase italic tracking-tighter">
            <TrendingDown size={32} />
            Critical Vulnerability (CAS-224)
          </h3>
          <h4 className="text-xl font-bold text-white mb-4">{data.threatVsOpportunity.threat.title}</h4>
          <p className="text-gray-400 leading-relaxed text-lg font-medium max-w-xl">
            {data.threatVsOpportunity.threat.content}
          </p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="p-10 rounded-[2.5rem] bg-gradient-to-br from-green-500/10 to-transparent border border-green-500/20 relative overflow-hidden group hover:from-green-500/20 transition-all duration-500"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
            <TrendingUp size={120} className="text-green-500" />
          </div>
          <h3 className="text-2xl font-black text-emerald-500 mb-6 flex items-center gap-4 uppercase italic tracking-tighter">
            <TrendingUp size={32} />
            Exponential Pivot Growth
          </h3>
          <h4 className="text-xl font-bold text-white mb-4">{data.threatVsOpportunity.opportunity.title}</h4>
          <p className="text-gray-400 leading-relaxed text-lg font-medium max-w-xl">
            {data.threatVsOpportunity.opportunity.content}
          </p>
        </motion.div>
      </section>

      {/* Strategic Insights Grid */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-3xl font-black text-white uppercase italic flex items-center gap-4">
            <Lightbulb className="text-[#E50000]" size={36} />
            Strategic Insights Engine
          </h3>
          <div className="h-px flex-1 bg-white/10 mx-6" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.insights.slice(0, 3).map((insight, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              className={`p-8 rounded-3xl border-l-4 bg-[#111111]/80 backdrop-blur-md shadow-2xl hover:bg-[#1a1a1a] transition-all group ${
                insight.type === 'danger' ? 'border-l-[#E50000] hover:shadow-[#E50000]/10' :
                insight.type === 'warning' ? 'border-l-[#FFC244] hover:shadow-[#FFC244]/10' :
                'border-l-green-500 hover:shadow-green-500/10'
              }`}
            >
              <h4 className="text-lg font-black mb-4 flex items-center gap-3 uppercase tracking-tight">
                {insight.type === 'danger' && <ShieldAlert size={20} className="text-[#E50000]" />}
                {insight.type === 'success' && <TrendingUp size={20} className="text-green-500" />}
                {insight.type === 'warning' && <Zap size={20} className="text-[#FFC244]" />}
                <span className={
                  insight.type === 'danger' ? 'text-red-500' : 
                  insight.type === 'warning' ? 'text-yellow-500' : 
                  'text-green-500'
                }>{insight.title}</span>
              </h4>
              <p className="text-gray-400 leading-relaxed text-sm font-medium">
                {insight.content}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* SWOT Quadrant Section */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-3xl font-black text-white uppercase italic flex items-center gap-4">
            <Zap className="text-[#E50000]" size={36} />
            SWOT Analysis Matrix
          </h3>
          <div className="h-px flex-1 bg-white/10 mx-6" />
        </div>
        <SWOTGrid data={data.swot} />
      </section>

      {/* Competitive & Environmental Section */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <MarketShareChart data={data.marketShares} />
        <InteractiveDataGrid data={data.pestel as any[]} />
      </section>

      {/* Strategic Roadmap */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-3xl font-black text-white uppercase italic flex items-center gap-4">
            <MoveRight className="text-[#E50000]" size={36} />
            Strategic Roadmap 2026-28
          </h3>
          <div className="h-px flex-1 bg-white/10 mx-6" />
        </div>
        <StrategicRoadmap data={data.strategicPriorities} />
      </section>

      {/* AI Transformation Section */}
      <section className="pb-20">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-3xl font-black text-white uppercase italic flex items-center gap-4">
            <Sparkles className="text-[#E50000]" size={36} />
            AI Acceleration 180D
          </h3>
          <div className="h-px flex-1 bg-white/10 mx-6" />
        </div>
        <AIRoadmap data={data.aiRoadmap} />
      </section>
    </div>
  );
}
