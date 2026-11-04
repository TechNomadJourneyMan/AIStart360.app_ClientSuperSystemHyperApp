'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';


interface Assessment {
    id: string;
    user_id: string;
    business_name: string | null;
    status: string;
    gri_index: number | null;
    created_at: string;
    completed_at: string | null;
}

interface SectionScore {
    name: string;
    avgScore: number;
}

export default function AssessmentsAdminPage() {
    const [assessments, setAssessments] = useState<Assessment[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
    const [selectedSections, setSelectedSections] = useState<SectionScore[]>([]);


    useEffect(() => {
        loadAssessments();
    }, []);

    const loadAssessments = async () => {
        try {
            const { data, error } = await supabase
                .from('assessments')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) console.error('Error loading assessments:', error);
            setAssessments(data || []);
        } catch (err) {
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadAssessmentDetails = async (assessment: Assessment) => {
        setSelectedAssessment(assessment);

        const { data: sections } = await supabase
            .from('sections')
            .select('name, average_score')
            .eq('assessment_id', assessment.id)
            .order('order_index');

        if (sections) {
            setSelectedSections(sections.map(s => ({
                name: s.name?.replace(' (Продукт и спрос)', '').replace(' (Команда)', '') || 'Section',
                avgScore: s.average_score || 0
            })));
        }
    };

    const getStatusBadge = (status: string) => {
        if (status === 'completed') {
            return <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full font-bold">Завершён</span>;
        }
        return <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full font-bold">В процессе</span>;
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-teal-400 animate-pulse">Загрузка...</div>
            </div>
        );
    }

    return (
        <div className="animate-fadeIn pb-20">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <Link href="/assessments" className="text-gray-500 hover:text-gray-400 text-sm mb-2 inline-block">
                        ← Назад
                    </Link>
                    <h1 className="text-3xl font-bold">GRI Assessments</h1>
                    <p className="text-gray-400 text-sm mt-1">{assessments.length} оценок в системе</p>
                </div>
                <Link
                    href="/assessments/onboarding"
                    className="bg-teal-500 hover:bg-teal-400 text-black font-bold py-2 px-6 rounded-full transition"
                >
                    + Новый тест
                </Link>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-gray-900/50 border border-white/10 rounded-xl p-4">
                    <div className="text-3xl font-bold text-white">{assessments.length}</div>
                    <div className="text-gray-400 text-sm">Всего тестов</div>
                </div>
                <div className="bg-gray-900/50 border border-white/10 rounded-xl p-4">
                    <div className="text-3xl font-bold text-green-400">{assessments.filter(a => a.status === 'completed').length}</div>
                    <div className="text-gray-400 text-sm">Завершено</div>
                </div>
                <div className="bg-gray-900/50 border border-white/10 rounded-xl p-4">
                    <div className="text-3xl font-bold text-teal-400">
                        {assessments.filter(a => a.gri_index).length > 0
                            ? (assessments.filter(a => a.gri_index).reduce((sum, a) => sum + (a.gri_index || 0), 0) / assessments.filter(a => a.gri_index).length).toFixed(1)
                            : '—'}
                    </div>
                    <div className="text-gray-400 text-sm">Средний GRI</div>
                </div>
            </div>

            {/* Assessments Table */}
            <div className="bg-gray-900/50 border border-white/10 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-white/10">
                    <h2 className="font-bold">История тестов</h2>
                </div>
                {assessments.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        Нет тестов
                    </div>
                ) : (
                    <div className="divide-y divide-white/5">
                        {assessments.map(assessment => (
                            <div
                                key={assessment.id}
                                onClick={() => loadAssessmentDetails(assessment)}
                                className="p-4 hover:bg-white/5 cursor-pointer transition flex items-center gap-4"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-3">
                                        <span className="font-medium">{assessment.business_name || 'Без названия'}</span>
                                        {getStatusBadge(assessment.status)}
                                    </div>
                                    <div className="text-gray-500 text-sm mt-1">
                                        ID: {assessment.user_id.substring(0, 20)}... • {formatDate(assessment.created_at)}
                                    </div>
                                </div>
                                <div className="text-right">
                                    {assessment.gri_index ? (
                                        <span className={`text-2xl font-bold ${assessment.gri_index >= 7 ? 'text-green-400' : assessment.gri_index >= 4 ? 'text-yellow-400' : 'text-red-400'}`}>
                                            {assessment.gri_index.toFixed(1)}
                                        </span>
                                    ) : (
                                        <span className="text-gray-500">—</span>
                                    )}
                                </div>
                                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedAssessment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80" onClick={() => setSelectedAssessment(null)} />
                    <div className="relative bg-gray-900 border border-white/20 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-auto">
                        <button
                            onClick={() => setSelectedAssessment(null)}
                            className="absolute top-4 right-4 text-gray-400 hover:text-white"
                        >
                            ✕
                        </button>

                        <h2 className="text-2xl font-bold mb-2">{selectedAssessment.business_name || 'Assessment'}</h2>
                        <div className="flex items-center gap-3 mb-6">
                            {getStatusBadge(selectedAssessment.status)}
                            <span className="text-gray-500 text-sm">{formatDate(selectedAssessment.created_at)}</span>
                        </div>

                        {selectedAssessment.gri_index && (
                            <div className="text-center mb-6">
                                <div className="text-5xl font-black text-teal-400">{selectedAssessment.gri_index.toFixed(1)}</div>
                                <div className="text-gray-400 text-sm">GRI Index</div>
                            </div>
                        )}

                        {selectedSections.length > 0 && (
                            <div className="space-y-3 mb-6">
                                <h3 className="font-bold text-sm text-gray-400 uppercase">По разделам:</h3>
                                {selectedSections.map((sec, idx) => (
                                    <div key={idx} className="flex items-center justify-between">
                                        <span className="text-sm text-gray-300">{sec.name}</span>
                                        <div className="flex items-center gap-2">
                                            <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${sec.avgScore >= 7 ? 'bg-green-500' : sec.avgScore >= 4 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                    style={{ width: `${(sec.avgScore / 10) * 100}%` }}
                                                />
                                            </div>
                                            <span className="text-sm font-bold w-8">{sec.avgScore.toFixed(1)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    if (typeof window !== 'undefined') {
                                        window.localStorage.setItem('gri_current_assessment_id', selectedAssessment.id);
                                    }
                                    window.location.href = '/assessments/results';
                                }}
                                className="flex-1 bg-teal-500 text-black font-bold py-3 rounded-lg hover:bg-teal-400 transition"
                            >
                                Открыть результаты
                            </button>
                            <a
                                href="https://tidycal.com/istart/gtm"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 border border-teal-500 text-teal-400 font-bold py-3 rounded-lg hover:bg-teal-500/10 transition text-center no-underline"
                            >
                                Забронировать разбор
                            </a>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
}
