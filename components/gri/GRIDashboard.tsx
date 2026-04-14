"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip as RechartsTooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import {
    AlertTriangle, TrendingUp, CheckCircle2, Target, Activity, Users, Shield,
    DollarSign, Briefcase, Zap, ArrowRight, Lock, Save, RotateCcw, Share2,
    Printer, ChevronRight, FileText, LayoutGrid, Table as TableIcon,
    Filter, ArrowUpDown, Download, Calculator
} from 'lucide-react';

// --- DATA STRUCTURES (Simulating CSV Content) ---

// Detailed sub-criteria based on GRI_v8_2.csv
const DETAILED_CRITERIA_INIT = {
    "Product & Demand": [
        { id: "p1", name: "Pain Criticality", score: 6, weight: 1.5, desc: "How much the client suffers without a solution" },
        { id: "p2", name: "High Check Potential", score: 5, weight: 1.2, desc: "Ability to sell expensive" },
        { id: "p3", name: "Repeat Purchases (LTV)", score: 7, weight: 1.0, desc: "Client return rate" }
    ],
    "Trust & Positioning": [
        { id: "t1", name: "Proof of Results", score: 5, weight: 1.5, desc: "Cases, numbers, facts" },
        { id: "t2", name: "Competitor differentiation", score: 6, weight: 1.2, desc: "Uniqueness of offer" },
        { id: "t3", name: "Media Weight", score: 4, weight: 0.8, desc: "Citation and recognition" }
    ],
    "Business Model": [
        { id: "b1", name: "Unit Economics", score: 8, weight: 1.5, desc: "Profit per sale" },
        { id: "b2", name: "Channel Scalability", score: 7, weight: 1.2, desc: "Can traffic be scaled x10" },
        { id: "b3", name: "Upsells and Cross-sells", score: 7, weight: 1.0, desc: "Additional sales to existing" }
    ],
    "Cash Stability": [
        { id: "c1", name: "Cash Gaps", score: 5, weight: 1.5, desc: "No negative balance" },
        { id: "c2", name: "Financial Planning", score: 4, weight: 1.2, desc: "P&L and Cashflow accuracy" },
        { id: "c3", name: "Return on Capital", score: 6, weight: 1.0, desc: "ROI" }
    ],
    "Operations": [
        { id: "o1", name: "Process Repeatability", score: 2, weight: 1.5, desc: "Result does not depend on luck" },
        { id: "o2", name: "Standards and Regulations", score: 2, weight: 1.0, desc: "Availability of instructions" },
        { id: "o3", name: "Automation", score: 3, weight: 1.0, desc: "CRM, ERP, Dashboards" }
    ],
    "Team": [
        { id: "tm1", name: "Staff Completeness", score: 3, weight: 1.5, desc: "Are key positions filled" },
        { id: "tm2", name: "Hiring Speed", score: 2, weight: 1.2, desc: "Vacancy closure time" },
        { id: "tm3", name: "Execution", score: 4, weight: 1.0, desc: "Meeting deadlines" }
    ],
    "Founder Readiness": [
        { id: "f1", name: "Stepping out of operations", score: 6, weight: 1.5, desc: "Focus on strategy" },
        { id: "f2", name: "Energy and Resources", score: 8, weight: 1.0, desc: "Personal effectiveness" },
        { id: "f3", name: "Scale Ambitions", score: 9, weight: 0.8, desc: "Desire to grow x10" }
    ]
};

const SECTIONS_CONFIG = {
    "Product & Demand": { icon: Target, label: "Product", color: "blue" },
    "Trust & Positioning": { icon: Shield, label: "Trust", color: "indigo" },
    "Business Model": { icon: Briefcase, label: "Model", color: "violet" },
    "Cash Stability": { icon: DollarSign, label: "Cash", color: "emerald" },
    "Operations": { icon: Zap, label: "Ops", color: "amber" },
    "Team": { icon: Users, label: "Team", color: "rose" },
    "Founder Readiness": { icon: Activity, label: "Founder", color: "cyan" },
};

const LIMITS_DATABASE = {
    "Operations": [
        { name: "Process Repeatability", threshold: 4, priority: "1" },
        { name: "Risks in Scaling", threshold: 4, priority: "2" },
        { name: "Team Result Metrics", threshold: 3, priority: "3" }
    ],
    "Team": [
        { name: "Staffing for $2M", threshold: 4, priority: "Critical" },
        { name: "Executive Discipline", threshold: 5, priority: "High" }
    ],
    "Trust & Positioning": [
        { name: "Proof of Results", threshold: 5, priority: "High" }
    ]
};

const ACTION_PLANS = {
    "Operations": [
        "Document 1-3 key business processes.",
        "Implement a daily rhythm (daily stand-up).",
        "Describe result standards."
    ],
    "Team": [
        "Redistribute workload from the owner.",
        "Implement a weekly sprint system.",
        "Launch ongoing hiring."
    ],
    "Product & Demand": [
        "Recheck product value (Offer).",
        "Reduce Time-to-Value for the client."
    ],
    "Trust & Positioning": [
        "Collect 5-10 solid case studies.",
        "Package 'Why us?'."
    ],
    "Cash Stability": [
        "Implement a payment calendar.",
        "Implement a P&L report."
    ]
};

// --- HELPER COMPONENTS ---

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        const dataPoint = payload.find((p: any) => p.name === "Current");
        if (!dataPoint) return null;
        const score = dataPoint.value;

        let statusColor = "text-emerald-400";
        let bgGradient = "from-emerald-900/90 to-slate-900/95";
        if (score < 4) { statusColor = "text-rose-400"; bgGradient = "from-rose-900/90 to-slate-900/95"; }
        else if (score < 7) { statusColor = "text-amber-400"; bgGradient = "from-amber-900/90 to-slate-900/95"; }

        return (
            <div className={`bg-gradient-to-br ${bgGradient} backdrop-blur-md border border-white/10 shadow-2xl rounded-xl p-4 text-sm z-50 text-white min-w-[180px]`}>
                <p className="font-bold text-white/60 uppercase text-[10px] tracking-widest mb-1">{label}</p>
                <div className="flex items-end gap-2 mb-2">
                    <span className={`text-4xl font-black ${statusColor}`}>{score}</span>
                    <span className="text-white/40 text-sm font-medium mb-1">/ 10</span>
                </div>
                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full ${score < 4 ? 'bg-rose-500' : score < 7 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${score * 10}%` }}></div>
                </div>
            </div>
        );
    }
    return null;
};

// --- MAIN COMPONENT ---

export default function InteractiveGRIDashboard() {
    const [viewMode, setViewMode] = useState('dashboard'); // 'dashboard' | 'table'
    const [detailedData, setDetailedData] = useState(DETAILED_CRITERIA_INIT);
    const [activeSection, setActiveSection] = useState("Operations");
    const [filterCritical, setFilterCritical] = useState(false);

    // Calculate aggregated scores dynamically
    const scores = useMemo(() => {
        const newScores: Record<string, number> = {};
        Object.keys(detailedData).forEach(section => {
            const items = detailedData[section as keyof typeof detailedData];
            const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
            const weightedSum = items.reduce((sum, item) => sum + (item.score * item.weight), 0);
            newScores[section] = parseFloat((weightedSum / totalWeight).toFixed(1));
        });
        return newScores;
    }, [detailedData]);

    const averageScore = useMemo(() => {
        const values = Object.values(scores);
        return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
    }, [scores]);

    // Handlers
    const handleDetailChange = (section: string, id: string, newVal: string) => {
        setDetailedData(prev => ({
            ...prev,
            [section]: prev[section as keyof typeof prev].map(item =>
                item.id === id ? { ...item, score: parseFloat(newVal) } : item
            )
        }));
    };

    const simulateScenario = (type: string) => {
        // "Optimistic" adds +1.5 to Team & Ops, "Pessimistic" removes -1.5 from Demand & Cash
        setDetailedData(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(key => {
                next[key as keyof typeof next] = next[key as keyof typeof next].map(item => {
                    let change = 0;
                    if (type === 'optimistic' && (key === 'Team' || key === 'Operations')) change = 2;
                    if (type === 'pessimistic' && (key === 'Product & Demand' || key === 'Cash Stability')) change = -2;
                    let newScore = Math.min(10, Math.max(1, item.score + change));
                    return { ...item, score: newScore };
                });
            });
            return next;
        });
    };

    const chartData = useMemo(() => {
        return Object.keys(SECTIONS_CONFIG).map(key => ({
            subject: key,
            A: scores[key],
            ZoneGreen: 10,
            ZoneYellow: 7,
            ZoneRed: 4
        }));
    }, [scores]);

    const activeLimits = useMemo(() => {
        let limits: any[] = [];
        Object.keys(scores).forEach(key => {
            if (LIMITS_DATABASE[key as keyof typeof LIMITS_DATABASE]) {
                LIMITS_DATABASE[key as keyof typeof LIMITS_DATABASE].forEach(limit => {
                    if (scores[key] <= limit.threshold) {
                        limits.push({ ...limit, block: key, currentScore: scores[key] });
                    }
                });
            }
        });
        return limits.sort((a, b) => a.currentScore - b.currentScore).slice(0, 5);
    }, [scores]);

    const activeActions = useMemo(() => {
        let actions: any[] = [];
        const sortedBlocks = Object.entries(scores).sort((a, b) => a[1] - b[1]);
        sortedBlocks.forEach(([block, score]) => {
            if (score < 7 && ACTION_PLANS[block as keyof typeof ACTION_PLANS]) {
                ACTION_PLANS[block as keyof typeof ACTION_PLANS].forEach(action => {
                    actions.push({ block, action });
                });
            }
        });
        return actions.slice(0, 5);
    }, [scores]);

    // Colors helpers
    const getScoreColor = (s: number) => s < 4 ? "text-rose-500" : s < 7 ? "text-amber-500" : "text-emerald-500";
    const getScoreBg = (s: number) => s < 4 ? "bg-rose-500" : s < 7 ? "bg-amber-500" : "bg-emerald-500";
    const getScoreBadge = (s: number) => s < 4 ? "bg-rose-100 text-rose-700 border-rose-200" : s < 7 ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-emerald-100 text-emerald-700 border-emerald-200";

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">

            {/* --- HEADER --- */}
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-30 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-tr from-blue-700 to-indigo-600 text-white p-2.5 rounded-xl shadow-lg shadow-blue-200">
                        <Target size={24} strokeWidth={2.5} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 leading-none">GRI Strategy <span className="text-slate-400 font-light">| $2M Workshop</span></h1>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">v.11.2 Interactive</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* View Switcher */}
                    <div className="bg-slate-100 p-1 rounded-lg flex border border-slate-200">
                        <button
                            onClick={() => setViewMode('dashboard')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'dashboard' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <LayoutGrid size={16} /> Dashboard
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'table' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <TableIcon size={16} /> Audit
                        </button>
                    </div>

                    <div className="h-8 w-px bg-slate-200"></div>

                    {/* Score Display */}
                    <div className="text-right">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Overall GRI</div>
                        <div className={`text-2xl font-black leading-none ${getScoreColor(parseFloat(averageScore))}`}>{averageScore}</div>
                    </div>
                </div>
            </header>

            {/* --- CONTENT AREA --- */}
            <main className="flex-grow p-6 max-w-[1920px] mx-auto w-full">

                {viewMode === 'dashboard' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                        {/* LEFT: Quick Tuner */}
                        <div className="lg:col-span-3 space-y-4">
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm uppercase tracking-wide">
                                        <Calculator className="w-4 h-4 text-blue-500" />
                                        Express Assessment
                                    </h3>
                                    <button
                                        onClick={() => setViewMode('table')}
                                        className="text-xs text-blue-600 font-medium hover:underline"
                                    >
                                        Details →
                                    </button>
                                </div>
                                <div className="space-y-5">
                                    {Object.entries(scores).map(([key, val]) => (
                                        <div key={key} onClick={() => setActiveSection(key)} className="group cursor-pointer">
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className={`text-sm font-semibold transition-colors ${activeSection === key ? 'text-blue-700' : 'text-slate-600 group-hover:text-slate-800'}`}>
                                                    {SECTIONS_CONFIG[key as keyof typeof SECTIONS_CONFIG].label}
                                                </span>
                                                <span className={`text-sm font-bold w-8 text-right ${getScoreColor(val)}`}>{val}</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                <div className={`h-full transition-all duration-500 ${getScoreBg(val)}`} style={{ width: `${val * 10}%` }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-6 pt-6 border-t border-slate-100 space-y-2">
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-2">Scenario Simulation</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={() => simulateScenario('pessimistic')} className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold transition-colors border border-rose-200">
                                            📉 Crisis
                                        </button>
                                        <button onClick={() => simulateScenario('optimistic')} className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold transition-colors border border-emerald-200">
                                            🚀 Growth x2
                                        </button>
                                    </div>
                                    <button onClick={() => setDetailedData(DETAILED_CRITERIA_INIT)} className="w-full mt-2 px-3 py-2 text-slate-400 hover:text-slate-600 text-xs font-medium flex items-center justify-center gap-1">
                                        <RotateCcw size={12} /> Reset
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* CENTER: Radar */}
                        <div className="lg:col-span-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-4 relative flex flex-col items-center justify-center min-h-[550px]">
                            <div className="absolute top-6 left-6 z-10">
                                <h2 className="text-xl font-bold text-slate-800">Readiness Diagram</h2>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${getScoreBadge(parseFloat(averageScore))}`}>
                                        {parseFloat(averageScore) < 4 ? "STOP SCALING" : parseFloat(averageScore) < 7 ? "RISK ZONE" : "READY TO SCALE"}
                                    </span>
                                </div>
                            </div>

                            <ResponsiveContainer width="100%" height={500}>
                                <RadarChart cx="50%" cy="53%" outerRadius="75%" data={chartData}>
                                    <PolarGrid stroke="#e2e8f0" strokeOpacity={0.6} />
                                    <PolarAngleAxis dataKey="subject" tick={({ payload, x, y, textAnchor }: any) => (
                                        <text x={x} y={y} dy={0} textAnchor={textAnchor} fill="#475569" fontSize="11" fontWeight="700">
                                            {payload.value.split(" ").map((line: string, i: number) => <tspan x={x} dy={i * 12} key={i}>{line}</tspan>)}
                                        </text>
                                    )} />
                                    <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
                                    <Radar name="ZoneGreen" dataKey="ZoneGreen" stroke="none" fill="#10b981" fillOpacity={0.05} />
                                    <Radar name="ZoneYellow" dataKey="ZoneYellow" stroke="none" fill="#f59e0b" fillOpacity={0.1} />
                                    <Radar name="ZoneRed" dataKey="ZoneRed" stroke="none" fill="#ef4444" fillOpacity={0.15} />
                                    <Radar name="Current" dataKey="A" stroke="#2563eb" strokeWidth={3} fill="#3b82f6" fillOpacity={0.5} activeDot={{ r: 6, fill: "#1d4ed8" }} />
                                    <RechartsTooltip content={<CustomTooltip />} />
                                </RadarChart>
                            </ResponsiveContainer>
                        </div>

                        {/* RIGHT: Active Context */}
                        <div className="lg:col-span-3 space-y-4">
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
                                <div className={`p-5 border-b ${getScoreBadge(scores[activeSection]).replace('text', 'bg-opacity-20 border-opacity-50')}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            {React.createElement(SECTIONS_CONFIG[activeSection as keyof typeof SECTIONS_CONFIG].icon, { className: `w-6 h-6 ${getScoreColor(scores[activeSection])}` })}
                                            <h3 className="font-bold text-lg text-slate-800">{activeSection}</h3>
                                        </div>
                                        <span className={`text-2xl font-black ${getScoreColor(scores[activeSection])}`}>{scores[activeSection]}</span>
                                    </div>
                                </div>

                                <div className="p-5 flex-grow overflow-y-auto custom-scrollbar">
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Assessment Breakdown</h4>
                                    <div className="space-y-3 mb-6">
                                        {detailedData[activeSection as keyof typeof detailedData].map((item) => (
                                            <div key={item.id} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-xs font-bold text-slate-600">{item.name}</span>
                                                    <span className={`text-xs font-bold ${getScoreColor(item.score)}`}>{item.score}</span>
                                                </div>
                                                <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                                                    <div className={`h-full ${getScoreBg(item.score)}`} style={{ width: `${item.score * 10}%` }}></div>
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-1">{item.desc}</p>
                                            </div>
                                        ))}
                                    </div>

                                    {scores[activeSection] < 7 && (
                                        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                                            <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1 mb-1">
                                                <AlertTriangle size={12} /> Attention
                                            </h4>
                                            <p className="text-xs text-amber-700 leading-snug">
                                                A low score in this block blocks scaling. It is recommended to raise it to at least 7.0.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* BOTTOM: Tables */}
                        <div className="lg:col-span-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-[320px] flex flex-col">
                            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <Lock className="w-5 h-5 text-rose-500" /> Top Constraints (Bottlenecks)
                            </h3>
                            <div className="overflow-y-auto custom-scrollbar space-y-2 flex-grow">
                                {activeLimits.map((limit: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3 p-3 bg-rose-50 border border-rose-100 rounded-lg group hover:border-rose-300 transition-colors">
                                        <div className="w-6 h-6 rounded-full bg-rose-200 text-rose-700 flex items-center justify-center font-bold text-xs flex-shrink-0">{i + 1}</div>
                                        <div className="flex-grow">
                                            <div className="flex justify-between">
                                                <span className="text-xs font-bold text-slate-500 uppercase">{limit.block}</span>
                                                <span className="text-xs font-bold text-rose-600">{limit.currentScore}</span>
                                            </div>
                                            <p className="text-sm font-bold text-slate-800">{limit.name}</p>
                                        </div>
                                    </div>
                                ))}
                                {activeLimits.length === 0 && <div className="text-center text-slate-400 py-10">No constraints</div>}
                            </div>
                        </div>

                        <div className="lg:col-span-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-[320px] flex flex-col">
                            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-blue-500" /> Action Plan (Sprint Backlog)
                            </h3>
                            <div className="overflow-y-auto custom-scrollbar space-y-2 flex-grow">
                                {activeActions.map((item: any, i: number) => (
                                    <div key={i} className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg hover:shadow-sm transition-shadow">
                                        <CheckCircle2 className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">{item.block}</span>
                                            <p className="text-sm text-slate-800 font-medium leading-snug">{item.action}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                ) : (
                    /* --- TABLE VIEW MODE --- */
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-140px)]">

                        {/* Toolbar */}
                        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 justify-between items-center bg-slate-50">
                            <div className="flex items-center gap-3">
                                <h2 className="font-bold text-slate-800 flex items-center gap-2">
                                    <TableIcon size={18} className="text-slate-500" />
                                    Detailed Audit
                                </h2>
                                <span className="text-xs px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-500">
                                    {Object.values(detailedData).flat().length} criteria
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setFilterCritical(!filterCritical)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${filterCritical ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                >
                                    <Filter size={14} /> Critical Only
                                </button>
                                <button className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm">
                                    <Download size={14} /> Export PDF
                                </button>
                            </div>
                        </div>

                        {/* Table Header */}
                        <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                            <div className="col-span-4">Criterion / Question</div>
                            <div className="col-span-2 text-center">Weight</div>
                            <div className="col-span-4">Score (1-10)</div>
                            <div className="col-span-2 text-right">Impact</div>
                        </div>

                        {/* Table Body */}
                        <div className="overflow-y-auto custom-scrollbar flex-grow bg-slate-50/50">
                            {Object.entries(detailedData).map(([section, items]) => {
                                // Filter logic
                                const visibleItems = filterCritical ? items.filter(i => i.score < 4) : items;
                                if (visibleItems.length === 0) return null;

                                return (
                                    <div key={section} className="mb-2">
                                        {/* Section Header Row */}
                                        <div className="px-6 py-2 bg-slate-200/50 border-y border-slate-200 flex justify-between items-center sticky top-0 backdrop-blur-sm z-10">
                                            <div className="flex items-center gap-2">
                                                {React.createElement(SECTIONS_CONFIG[section as keyof typeof SECTIONS_CONFIG].icon, { size: 14, className: "text-slate-500" })}
                                                <span className="font-bold text-sm text-slate-700">{section}</span>
                                            </div>
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${getScoreBadge(scores[section])}`}>
                                                Avg: {scores[section]}
                                            </span>
                                        </div>

                                        {/* Rows */}
                                        {visibleItems.map((item) => (
                                            <div key={item.id} className="grid grid-cols-12 gap-4 px-6 py-4 bg-white border-b border-slate-100 hover:bg-blue-50/30 transition-colors items-center group">

                                                <div className="col-span-4">
                                                    <p className="font-bold text-sm text-slate-800">{item.name}</p>
                                                    <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                                                </div>

                                                <div className="col-span-2 text-center text-xs text-slate-400 font-medium">
                                                    x{item.weight}
                                                </div>

                                                <div className="col-span-4">
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            type="range"
                                                            min="1"
                                                            max="10"
                                                            step="0.5"
                                                            value={item.score}
                                                            onChange={(e) => handleDetailChange(section, item.id, e.target.value)}
                                                            className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${getScoreBg(item.score)}`}
                                                        />
                                                        <span className={`w-8 text-right font-bold text-sm ${getScoreColor(item.score)}`}>{item.score}</span>
                                                    </div>
                                                </div>

                                                <div className="col-span-2 text-right">
                                                    {item.score < 4 ? (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-100 px-2 py-1 rounded-full uppercase tracking-wide">
                                                            <AlertTriangle size={10} /> Critical
                                                        </span>
                                                    ) : item.score < 7 ? (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-1 rounded-full uppercase tracking-wide">
                                                            Risk
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full uppercase tracking-wide">
                                                            OK
                                                        </span>
                                                    )}
                                                </div>

                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

            </main>
        </div>
    );
}
