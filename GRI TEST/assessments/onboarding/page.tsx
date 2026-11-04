'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AssessmentScale from '@/components/gri/AssessmentScale';
import { supabase } from '@/lib/supabase';

// Helper to save to localStorage
const useStickyState = (defaultValue: any, key: string) => {
    const [value, setValue] = useState(() => {
        if (typeof window !== 'undefined') {
            const stickyValue = window.localStorage.getItem(key);
            return stickyValue !== null ? JSON.parse(stickyValue) : defaultValue;
        }
        return defaultValue;
    });

    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(key, JSON.stringify(value));
        }
    }, [key, value]);
    return [value, setValue];
};

export default function OnboardingPage() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);

    // Form State
    const [formData, setFormData] = useStickyState({
        name: '',
        phone: '',
        email: '',
        yearsOnMarket: '',
        industry: '',
        employees: '',
        revenue: '',
        goal: '',
        competitors: '',
        mainPain: '',
        scoreProcess: null,
        scoreManagement: null,
        scoreTeam: null,
    }, 'gri_onboarding_data');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleScoreChange = (key: string, value: number) => {
        setFormData({ ...formData, [key]: value });
    };

    const handleNext = () => {
        if (step < 3) {
            setStep(step + 1);
            window.scrollTo(0, 0);
        } else {
            createAssessment();
        }
    };

    const createAssessment = async () => {
        setLoading(true);
        try {
            // Try to get authenticated user, but allow anonymous for testing
            const { data: { user } } = await supabase.auth.getUser();

            let userId = user?.id;

            // If no authenticated user, create/use a temporary anonymous ID
            if (!userId) {
                let tempUserId = localStorage.getItem('gri_temp_user_id');
                if (!tempUserId) {
                    tempUserId = 'temp_user_' + Math.random().toString(36).substring(2, 15);
                    localStorage.setItem('gri_temp_user_id', tempUserId);
                }
                userId = tempUserId;
            }

            // Create assessment in DB
            const { data, error } = await supabase
                .from('assessments')
                .insert([
                    {
                        user_id: userId,
                        business_name: formData.industry || 'My Business',
                        status: 'in_progress',
                        assessment_date: new Date().toISOString()
                    }
                ])
                .select()
                .single();

            if (error) throw error;

            // Save assessment ID and form data to localStorage
            if (typeof window !== 'undefined') {
                window.localStorage.setItem('gri_current_assessment_id', data.id);
                window.localStorage.setItem('gri_user_info', JSON.stringify(formData));
            }

            router.push('/assessments/overview');
        } catch (error: any) {
            console.error('Error creating assessment:', error);
            alert('Ошибка при создании оценки: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto animate-fadeIn">
            {/* Progress */}
            <div className="mb-8">
                <div className="text-sm text-gray-400 mb-2">Шаг {step} из 3</div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-teal-500 transition-all duration-300"
                        style={{ width: `${(step / 3) * 100}%` }}
                    />
                </div>
            </div>

            <div className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 sm:p-8 backdrop-blur-sm">
                {step === 1 && (
                    <div className="space-y-6">
                        <h2 className="text-2xl font-bold">Давайте познакомимся</h2>

                        <div className="grid grid-cols-1 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Как вас зовут?</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all"
                                    placeholder="Иван Иванов"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all"
                                    placeholder="ivan@example.com"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Телефон</label>
                                <input
                                    type="tel"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all"
                                    placeholder="+7 (999) 000-00-00"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6">
                        <h2 className="text-2xl font-bold">О вашем бизнесе</h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Отрасль</label>
                                <select
                                    name="industry"
                                    value={formData.industry}
                                    onChange={handleChange}
                                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all appearance-none"
                                >
                                    <option value="">Выберите...</option>
                                    <option value="it">IT / SaaS</option>
                                    <option value="e-commerce">E-commerce</option>
                                    <option value="services">Услуги</option>
                                    <option value="manufacturing">Производство</option>
                                    <option value="other">Другое</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Сотрудников</label>
                                <select
                                    name="employees"
                                    value={formData.employees}
                                    onChange={handleChange}
                                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all appearance-none"
                                >
                                    <option value="">Выберите...</option>
                                    <option value="1-5">1-5</option>
                                    <option value="6-10">6-10</option>
                                    <option value="11-20">11-20</option>
                                    <option value="21-50">21-50</option>
                                    <option value="51-100">51-100</option>
                                    <option value="100+">100+</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Оборот (в месяц)</label>
                                <select
                                    name="revenue"
                                    value={formData.revenue}
                                    onChange={handleChange}
                                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all appearance-none"
                                >
                                    <option value="">Выберите...</option>
                                    <option value="<10k">До $10,000</option>
                                    <option value="10k-50k">$10k - $50k</option>
                                    <option value="50k-100k">$50k - $100k</option>
                                    <option value="100k+">$100k+</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Лет на рынке</label>
                                <select
                                    name="yearsOnMarket"
                                    value={formData.yearsOnMarket}
                                    onChange={handleChange}
                                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all appearance-none"
                                >
                                    <option value="">Выберите...</option>
                                    <option value="0-1">0-1</option>
                                    <option value="2-3">2-3</option>
                                    <option value="4-5">4-5</option>
                                    <option value="6-10">6-10</option>
                                    <option value="10+">10+</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Главная боль</label>
                            <textarea
                                name="mainPain"
                                value={formData.mainPain}
                                onChange={handleChange}
                                rows={3}
                                className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all"
                                placeholder="Опишите главную проблему вашего бизнеса"
                            />
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="space-y-8">
                        <h2 className="text-2xl font-bold">Самооценка готовности</h2>
                        <p className="text-gray-400">Оцените вашу готовность по 10-балльной шкале</p>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-white mb-4">На сколько вы оцените готовность процессов к $2М?</label>
                                <AssessmentScale
                                    value={formData.scoreProcess}
                                    onChange={(val) => handleScoreChange('scoreProcess', val)}
                                />
                            </div>

                            <div className="border-t border-white/10 pt-6">
                                <label className="block text-sm font-medium text-white mb-4">На сколько вы готовы управлять бизнесом с оборотом $2M?</label>
                                <AssessmentScale
                                    value={formData.scoreManagement}
                                    onChange={(val) => handleScoreChange('scoreManagement', val)}
                                />
                            </div>

                            <div className="border-t border-white/10 pt-6">
                                <label className="block text-sm font-medium text-white mb-4">На сколько вы оцените готовность команды к $2М?</label>
                                <AssessmentScale
                                    value={formData.scoreTeam}
                                    onChange={(val) => handleScoreChange('scoreTeam', val)}
                                />
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-8 flex justify-end">
                    <button
                        onClick={handleNext}
                        disabled={loading}
                        className="bg-white text-black font-bold py-3 px-8 rounded-full hover:bg-teal-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Создаем...' : step === 3 ? 'Перейти к оценке' : 'Далее'}
                    </button>
                </div>
            </div>
        </div>
    );
}
