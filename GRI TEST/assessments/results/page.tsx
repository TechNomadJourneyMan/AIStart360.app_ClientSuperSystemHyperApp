'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { GRI_SECTIONS } from '../data/sections';
import GriRadarChart from '@/components/gri/GriRadarChart';


interface SectionResult {
    name: string;
    shortTitle: string;
    avgScore: number;
}

interface CriterionResult {
    id: string;
    text: string;
    score: number;
    sectionName: string;
}

export default function ResultsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [assessmentId, setAssessmentId] = useState<string | null>(null);

    const [griIndex, setGriIndex] = useState(0);
    const [sectionResults, setSectionResults] = useState<SectionResult[]>([]);
    const [topWeaknesses, setTopWeaknesses] = useState<CriterionResult[]>([]);
    const [chartData, setChartData] = useState<{ subject: string; score: number; benchmark: number }[]>([]);


    useEffect(() => {
        if (typeof window !== 'undefined') {
            const id = window.localStorage.getItem('gri_current_assessment_id');
            if (!id) {
                router.push('/assessments/onboarding');
                return;
            }
            setAssessmentId(id);
            loadResults(id);
        }
    }, []);

    const loadResults = async (id: string) => {
        try {
            setLoading(true);

            const { data: sections } = await supabase
                .from('sections')
                .select('*')
                .eq('assessment_id', id)
                .order('order_index');

            if (!sections || sections.length === 0) {
                setLoading(false);
                return;
            }

            const sectionIds = sections.map(s => s.id);
            const { data: allCriteria } = await supabase
                .from('criteria')
                .select('*')
                .in('section_id', sectionIds)
                .not('score', 'is', null);

            if (allCriteria) {
                const criteriaPerSection: Record<string, number> = {};
                allCriteria.forEach(c => {
                    criteriaPerSection[c.section_id] = (criteriaPerSection[c.section_id] || 0) + 1;
                });
            }

            if (!allCriteria || allCriteria.length === 0) {
                setLoading(false);
                return;
            }

            const totalScore = allCriteria.reduce((sum, c) => sum + (c.score || 0), 0);
            const index = totalScore / allCriteria.length;
            setGriIndex(parseFloat(index.toFixed(1)));

            const mappedSections: SectionResult[] = [];
            const chartDataArr: { subject: string; score: number; benchmark: number }[] = [];

            GRI_SECTIONS.forEach((staticSec, idx) => {
                const matchingSections = sections.filter(s => s.order_index === idx || s.name === staticSec.title);

                let dbSection = null;
                let secCriteria: any[] = [];

                for (const sec of matchingSections) {
                    const criteria = allCriteria.filter(c => c.section_id === sec.id);
                    if (criteria.length > secCriteria.length) {
                        dbSection = sec;
                        secCriteria = criteria;
                    }
                }

                if (!dbSection && matchingSections.length > 0) {
                    dbSection = matchingSections[0];
                }
                const secAvg = secCriteria.length > 0
                    ? secCriteria.reduce((sum, c) => sum + (c.score || 0), 0) / secCriteria.length
                    : 0;

                mappedSections.push({
                    name: staticSec.title,
                    shortTitle: staticSec.shortTitle,
                    avgScore: parseFloat(secAvg.toFixed(1))
                });

                chartDataArr.push({
                    subject: staticSec.shortTitle,
                    score: parseFloat(secAvg.toFixed(1)),
                    benchmark: 8
                });
            });

            setSectionResults(mappedSections);
            setChartData(chartDataArr);

            const sortedCriteria = [...allCriteria]
                .sort((a, b) => (a.score || 0) - (b.score || 0))
                .slice(0, 5);

            const weaknesses: CriterionResult[] = sortedCriteria.map(c => {
                const sec = sections.find(s => s.id === c.section_id);
                return {
                    id: c.id,
                    text: c.criterion_text,
                    score: c.score || 0,
                    sectionName: sec?.name || 'Unknown'
                };
            });

            setTopWeaknesses(weaknesses);

            await supabase.from('assessments').update({
                gri_index: parseFloat(index.toFixed(2)),
                status: 'completed',
                completed_at: new Date().toISOString()
            }).eq('id', id);

            // Send results to email and Google Sheets
            try {
                const userInfo = JSON.parse(localStorage.getItem('gri_user_info') || '{}');
                await fetch('/api/assessments/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userInfo,
                        griIndex: parseFloat(index.toFixed(1)),
                        sectionResults: mappedSections,
                        topWeaknesses: weaknesses
                    })
                });
                console.log('Assessment results sent to email/sheets');
            } catch (submitError) {
                console.error('Error sending assessment results:', submitError);
            }

            setLoading(false);
        } catch (err) {
            console.error('Error loading results:', err);
            setLoading(false);
        }
    };





    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-teal-400 animate-pulse text-lg">Подсчёт результатов...</div>
            </div>
        );
    }

    const getGriStatus = () => {
        if (griIndex >= 8) return { color: 'green', label: '✅ Отличная готовность', desc: 'Бизнес готов к агрессивному росту.' };
        if (griIndex >= 5) return { color: 'yellow', label: '⚠️ Средняя готовность', desc: 'Есть риски. Исправьте красные зоны.' };
        return { color: 'red', label: '🚨 Критическое состояние', desc: 'Масштабирование невозможно без изменений.' };
    };

    const status = getGriStatus();

    return (
        <div className="animate-fadeIn pb-20">
            {/* Header */}
            <div className="mb-10">
                <div className="inline-block bg-teal-900/30 text-teal-400 px-3 py-1 rounded-full text-xs font-bold mb-4 border border-teal-500/30">
                    РЕЗУЛЬТАТ ГОТОВ
                </div>
                <h1 className="text-4xl font-bold mb-2">Ваш GRI Индекс</h1>
                <p className="text-gray-400 text-sm max-w-xl">
                    Теперь вы знаете свои сильные стороны и зоны роста.
                </p>
            </div>

            {/* Main Score + Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                <div className="space-y-6">
                    <div className="flex items-baseline gap-4">
                        <span className={`text-7xl font-black ${status.color === 'green' ? 'text-green-400' : status.color === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>
                            {griIndex}
                        </span>
                        <div className="text-sm text-gray-500">
                            <span className="text-teal-400 text-2xl font-bold block">8.5+</span>
                            ЦЕЛЬ
                        </div>
                    </div>

                    <div className={`p-4 rounded-xl border ${status.color === 'green' ? 'bg-green-900/20 border-green-500/50' :
                        status.color === 'yellow' ? 'bg-yellow-900/20 border-yellow-500/50' :
                            'bg-red-900/20 border-red-500/50'
                        }`}>
                        <h3 className={`font-bold ${status.color === 'green' ? 'text-green-400' : status.color === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>
                            {status.label}
                        </h3>
                        <p className="text-gray-300 text-sm mt-1">{status.desc}</p>
                    </div>

                    <div className="space-y-2">
                        {sectionResults.map((sec, idx) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                                <span className="text-gray-300">{sec.shortTitle}</span>
                                <div className="flex items-center gap-2">
                                    <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full ${sec.avgScore >= 7 ? 'bg-green-500' : sec.avgScore >= 4 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                            style={{ width: `${(sec.avgScore / 10) * 100}%` }} />
                                    </div>
                                    <span className="font-bold w-6">{sec.avgScore}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="lg:col-span-2 bg-gray-900/50 border border-white/10 rounded-2xl p-6">
                    <GriRadarChart data={chartData} height={350} />
                </div>
            </div>

            {/* TOP-5 */}
            {topWeaknesses.length > 0 && (
                <div className="mb-12">
                    <h2 className="text-xl font-bold mb-4 text-red-400">🔥 TOP-5 Ограничений</h2>
                    <div className="space-y-3">
                        {topWeaknesses.map((w, idx) => (
                            <div key={w.id} className="bg-gray-900/80 border border-red-900/30 p-4 rounded-xl flex items-center gap-4">
                                <div className="w-8 h-8 flex items-center justify-center bg-red-500/10 text-red-500 font-bold rounded-lg text-sm">
                                    {idx + 1}
                                </div>
                                <div className="flex-1">
                                    <div className="text-xs text-gray-500">{w.sectionName}</div>
                                    <div className="font-medium">{w.text}</div>
                                </div>
                                <div className="px-2 py-1 bg-red-500 text-white text-sm font-bold rounded">{w.score}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Booking Section */}
            <div className="bg-gradient-to-br from-teal-900/40 to-black border border-teal-500/30 rounded-3xl p-8 text-center relative overflow-hidden">
                <h2 className="text-2xl font-bold mb-3">Получите план действий на 90 дней</h2>
                <p className="text-gray-300 max-w-xl mx-auto mb-6">
                    Забронируйте разбор с экспертом и получите пошаговый план.
                </p>

                <a
                    href="https://tidycal.com/istart/gtm"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-8 py-4 text-lg font-bold text-black bg-teal-400 rounded-full hover:bg-teal-300 transition"
                >
                    📅 Забронировать разбор
                </a>
            </div>

            <div className="mt-8 text-center">
                <button onClick={() => router.push('/assessments')} className="text-gray-400 hover:text-white transition text-sm">
                    ← Вернуться к списку
                </button>
            </div>
        </div>
    );
}
