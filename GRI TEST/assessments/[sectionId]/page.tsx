'use client';

import React, { useEffect, useState, use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { GRI_SECTIONS, SectionId, GriSection } from '../data/sections';
import AssessmentScale from '@/components/gri/AssessmentScale';
import LossAversionBar from '@/components/gri/LossAversionBar';

interface DbCriterion {
    id: string;
    criterion_text: string;
    score: number | null;
    order_index: number;
}

export default function SectionPage({ params }: { params: Promise<{ sectionId: string }> }) {
    const router = useRouter();
    const resolvedParams = use(params);
    const sectionId = resolvedParams.sectionId as SectionId;

    const sectionData: GriSection | undefined = GRI_SECTIONS.find(s => s.id === sectionId);
    const sectionIndex = GRI_SECTIONS.findIndex(s => s.id === sectionId);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [assessmentId, setAssessmentId] = useState<string | null>(null);
    const [dbSectionId, setDbSectionId] = useState<string | null>(null);
    const [criteria, setCriteria] = useState<DbCriterion[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const storedId = window.localStorage.getItem('gri_current_assessment_id');
            if (!storedId) {
                router.push('/assessments/onboarding');
                return;
            }
            setAssessmentId(storedId);

            if (sectionData) {
                initSection(storedId);
            } else {
                setError(`Section "${sectionId}" not found`);
                setLoading(false);
            }
        }
    }, [sectionId]);

    const initSection = async (assId: string) => {
        if (!sectionData) return;

        try {
            setLoading(true);
            setError(null);

            let { data: section } = await supabase
                .from('sections')
                .select('*')
                .eq('assessment_id', assId)
                .eq('order_index', sectionIndex)
                .maybeSingle();

            if (!section) {
                const { data: sectionByName } = await supabase
                    .from('sections')
                    .select('*')
                    .eq('assessment_id', assId)
                    .eq('name', sectionData.title)
                    .maybeSingle();
                section = sectionByName;
            }

            if (!section) {
                const { data: newSection, error: createError } = await supabase
                    .from('sections')
                    .insert({
                        assessment_id: assId,
                        name: sectionData.title,
                        average_score: 0,
                        order_index: sectionIndex
                    })
                    .select()
                    .single();

                if (createError) {
                    setError('Ошибка создания раздела');
                    setLoading(false);
                    return;
                }
                section = newSection;

                const criteriaToInsert = sectionData.criteria.map((c, idx) => ({
                    section_id: newSection.id,
                    criterion_text: c.text,
                    score: null,
                    order_index: idx
                }));

                await supabase.from('criteria').insert(criteriaToInsert);
            }

            setDbSectionId(section.id);

            const { data: loadedCriteria } = await supabase
                .from('criteria')
                .select('*')
                .eq('section_id', section.id)
                .order('order_index');

            setCriteria(loadedCriteria || []);
            setCurrentQuestionIndex(0);

            const { data: noteData } = await supabase
                .from('section_notes')
                .select('notes_text')
                .eq('assessment_id', assId)
                .eq('section_name', sectionData.title)
                .maybeSingle();

            if (noteData) setNotes(noteData.notes_text || '');
            setLoading(false);
        } catch (err: any) {
            setError('Ошибка: ' + err.message);
            setLoading(false);
        }
    };

    // Debounced save
    const saveScore = useCallback(async (criterionId: string, score: number, newCriteria: DbCriterion[]) => {
        setSaving(true);
        try {
            await supabase.from('criteria').update({ score }).eq('id', criterionId);

            const validScores = newCriteria.filter(c => c.score !== null).map(c => c.score as number);
            if (validScores.length > 0 && dbSectionId) {
                const avg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
                await supabase.from('sections').update({ average_score: avg }).eq('id', dbSectionId);
            }
        } finally {
            setSaving(false);
        }
    }, [dbSectionId]);

    const handleScore = (score: number) => {
        if (criteria.length === 0) return;

        // Ensure index is within bounds
        const safeIndex = Math.min(currentQuestionIndex, criteria.length - 1);
        const currentCriterion = criteria[safeIndex];
        if (!currentCriterion) return;

        const newCriteria = [...criteria];
        newCriteria[safeIndex] = { ...currentCriterion, score };
        setCriteria(newCriteria);

        // Async save (non-blocking)
        saveScore(currentCriterion.id, score, newCriteria);

        // Auto-advance after short delay
        setTimeout(() => {
            if (safeIndex < criteria.length - 1) {
                setCurrentQuestionIndex(safeIndex + 1);
            }
        }, 300);
    };

    const saveNotesToDb = async () => {
        if (!assessmentId || !sectionData) return;
        await supabase
            .from('section_notes')
            .upsert(
                { assessment_id: assessmentId, section_name: sectionData.title, notes_text: notes },
                { onConflict: 'assessment_id,section_name' }
            );
    };

    const handleNextSection = () => {
        saveNotesToDb();
        const currentSectionId = GRI_SECTIONS[sectionIndex].id;
        localStorage.setItem(`gri_section_${currentSectionId}_completed`, 'true');
        if (sectionIndex < GRI_SECTIONS.length - 1) {
            router.push(`/assessments/${GRI_SECTIONS[sectionIndex + 1].id}`);
        } else {
            router.push('/assessments/results');
        }
    };

    const goToQuestion = (idx: number) => {
        if (idx >= 0 && idx < criteria.length) {
            setCurrentQuestionIndex(idx);
        }
    };

    if (error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center text-center p-8">
                <div className="text-red-400 text-xl mb-4">⚠️ {error}</div>
                <button onClick={() => router.push('/assessments/overview')} className="bg-white text-black px-6 py-3 rounded-full font-bold">
                    Вернуться
                </button>
            </div>
        );
    }

    if (!sectionData) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center">
                <div className="text-yellow-400 mb-4">Раздел не найден: {sectionId}</div>
                <button onClick={() => router.push('/assessments/overview')} className="bg-white text-black px-6 py-3 rounded-full font-bold">
                    Назад
                </button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-teal-400 animate-pulse">Загрузка...</div>
            </div>
        );
    }

    // Safe index bounds
    const safeIndex = Math.min(currentQuestionIndex, Math.max(0, criteria.length - 1));
    const currentCriterion = criteria[safeIndex];
    const staticCriterionData = sectionData.criteria[safeIndex];
    const isFinishedQuestions = criteria.length > 0 && criteria.every(c => c.score !== null);
    const validScores = criteria.filter(c => c.score !== null).map(c => c.score as number);
    const avgScore = validScores.length > 0 ? validScores.reduce((a, b) => a + b, 0) / validScores.length : 0;

    return (
        <div className="animate-fadeIn min-h-screen pb-20">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
                {sectionIndex > 0 && (
                    <button onClick={() => router.push(`/assessments/${GRI_SECTIONS[sectionIndex - 1].id}`)} className="text-gray-400 hover:text-white transition text-sm">
                    ← Назад
                </button>
                )}

                <div className="text-sm font-bold text-teal-400">
                    Блок {sectionIndex + 1}: {sectionData.shortTitle}
                </div>


                <div className="text-sm text-gray-500">
                    {safeIndex + 1} / {criteria.length}
                </div>
                                {isFinishedQuestions && (
                <button onClick={() => router.push(`/assessments/${GRI_SECTIONS[sectionIndex + 1].id}`)} className="text-gray-400 hover:text-white transition text-sm">
                    Вперед →
                </button>

                )}
  
            </div>

            {/* Progress Bar */}
            <div className="h-1.5 bg-gray-800 rounded-full mb-6 overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-300"
                    style={{ width: `${((safeIndex + 1) / Math.max(1, criteria.length)) * 100}%` }}
                />
            </div>

            {/* Question Dots */}
            <div className="flex justify-center gap-2 mb-6">
                {criteria.map((c, idx) => (
                    <button
                        key={c.id}
                        onClick={() => goToQuestion(idx)}
                        className={`w-3 h-3 rounded-full transition-all ${idx === safeIndex
                            ? 'bg-teal-500 scale-125'
                            : c.score !== null
                                ? 'bg-teal-500/50'
                                : 'bg-gray-600'
                            }`}
                    />
                ))}
            </div>

            {/* Question Card */}
            <div className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 sm:p-8 backdrop-blur-sm">
                <h2 className="text-2xl sm:text-3xl font-bold mb-3">
                    {staticCriterionData?.text || 'Вопрос'}
                </h2>
                <p className="text-gray-400 mb-6">
                    {staticCriterionData?.description || 'Оцените по шкале от 1 до 10'}
                </p>

                <AssessmentScale
                    value={currentCriterion?.score}
                    onChange={handleScore}
                />

                {saving && (
                    <div className="text-center text-xs text-gray-500 mt-2">Сохранение...</div>
                )}

                {/* Nav */}
                <div className="flex justify-between mt-6 text-sm">
                    <button
                        onClick={() => goToQuestion(safeIndex - 1)}
                        disabled={safeIndex === 0}
                        className="text-gray-400 hover:text-white disabled:opacity-30 transition"
                    >
                        ← Предыдущий
                    </button>
                    <button
                        onClick={() => goToQuestion(safeIndex + 1)}
                        disabled={safeIndex >= criteria.length - 1}
                        className="text-gray-400 hover:text-white disabled:opacity-30 transition"
                    >
                        Следующий →
                    </button>
                </div>

                {/* Hints */}
                {staticCriterionData && (
                    <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {/* <div>
                            <span className="text-gray-500 text-xs uppercase">Что теряет бизнес:</span>
                            <p className="text-red-300 mt-1">{staticCriterionData.businessLoss}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 text-xs uppercase">Что улучшить:</span>
                            <p className="text-teal-300 mt-1">{staticCriterionData.whatToImprove}</p>
                        </div> */}
                    </div>
                )}
            </div>

            {/* Warning Block - показывается если оценка ≤ 6
            {currentCriterion?.score !== null && currentCriterion?.score <= 6 && (
                <div className={`mt-6 rounded-xl p-5 ${currentCriterion.score <= 3
                        ? 'bg-red-500/20 border border-red-500/50'
                        : 'bg-orange-500/20 border border-orange-500/50'
                    }`}>
                    <div className="flex items-start gap-3">
                        <span className="text-2xl">{currentCriterion.score <= 3 ? '🚨' : '⚠️'}</span>
                        <div>
                            <h4 className={`font-bold ${currentCriterion.score <= 3 ? 'text-red-400' : 'text-orange-400'}`}>
                                {currentCriterion.score <= 3 ? 'Критический уровень' : 'Слабое место'}
                            </h4>
                            <p className="text-white text-sm mt-1">
                                Вы теряете: {staticCriterionData?.businessLoss || 'ресурсы и время'}
                            </p>
                        </div>
                    </div>
                </div>
            )} */}

            {/* Loss Bar */}
            {validScores.length > 0 && (
                <LossAversionBar score={null} sectionAvg={avgScore} />
            )}

            {/* Complete Section */}
            {isFinishedQuestions && (
                <div className="mt-8 space-y-6 animate-fadeIn">
                    <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-6">
                        <h3 className="font-bold text-green-400 mb-2">✅ Раздел завершён!</h3>
                        <p className="text-gray-400 text-sm">Средний балл: <span className="text-white font-bold">{avgScore.toFixed(1)}</span></p>
                    </div>

                    {/* <div className="bg-gray-900/50 border border-white/10 rounded-xl p-6">
                        
                        <h3 className="font-bold mb-3 text-white">📝 Заметки (опционально)</h3>
                        <textarea
                            className="w-full bg-black/50 border border-white/20 rounded-lg p-3 text-white focus:ring-2 focus:ring-teal-500 outline-none text-sm placeholder-gray-500"
                            rows={3}
                            placeholder="Ваши мысли и инсайты..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            onBlur={saveNotesToDb}
                        />
                    </div> */}

                    <button
                        onClick={handleNextSection}
                        className="w-full bg-green-500 text-black font-bold py-4 rounded-full hover:bg-green-400 transition text-lg shadow-lg shadow-green-500/50 hover:shadow-green-400/60"
                    >
                        {sectionIndex === GRI_SECTIONS.length - 1 ? '🎯 Получить результаты' : 'Следующий раздел →'}
                    </button>
                </div>
            )}
        </div>
    );
}
