'use client';

import Link from 'next/link';
import GriRadarChart, { DEMO_GRI_DATA } from '@/components/gri/GriRadarChart';

export default function AssessmentLandingPage() {
    return (
    
        <div className="animate-fadeIn pb-20">
            {/* Hero Section */}
            <div className="flex flex-col items-center justify-center min-h-[40vh] text-center space-y-6 mb-16">
                <div className="space-y-4 max-w-2xl">
                    <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        Оцените готовность вашего бизнеса к масштабированию
                    </h1>
                    <p className="text-lg text-gray-400">
                        Пройдите профессиональный GRI-тест и получите детальный план действий, чтобы вырасти до $2M+.
                    </p>
                </div>

                <div className="pt-4">
                    <Link
                        href="/assessments/onboarding"
                        className="group relative inline-flex items-center justify-center px-8 py-4 text-lg font-bold text-black transition-all duration-200 bg-white rounded-full hover:bg-teal-50 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 focus:ring-offset-black"
                    >
                        Начать оценку
                        <svg className="w-5 h-5 ml-2 -mr-1 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                    </Link>
                    <p className="mt-4 text-sm text-gray-500">
                        Займет около 15-20 минут
                    </p>
                </div>
            </div>

            {/* GRI Index Block */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                {/* Left Column - Info */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-teal-900/30 text-teal-400 text-xs font-bold px-3 py-1 rounded inline-block border border-teal-500/30">
                        Решение для роста
                    </div>

                    <h2 className="text-3xl font-bold text-white">
                        Ваш GRI Индекс
                    </h2>

                    <p className="text-gray-400 text-sm leading-relaxed">
                        Growth Readiness Index (GRI) — это скоринг готовности к масштабированию (0-10).
                        Большинство имеют сильный продукт, но слабые операции.
                    </p>

                    {/* Insight Warning */}
                    <div className="p-4 bg-yellow-900/30 border-l-4 border-yellow-500 rounded-r-lg">
                        <div className="flex gap-3">
                            <span className="text-xl text-yellow-500">⚠️</span>
                            <div>
                                <h4 className="font-bold text-yellow-300 text-sm">Инсайт</h4>
                                <p className="text-xs text-yellow-200/80 mt-1">
                                    Вы не можете масштабировать хаос. Сначала исправьте 'Красные Зоны' (Operations).
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Score Display */}
                    <div className="flex gap-6 pt-4">
                        <div>
                            <div className="text-4xl font-black text-white">4.9</div>
                            <div className="text-xs text-gray-500 uppercase font-bold">ТЕКУЩИЙ GRI</div>
                        </div>
                        <div className="w-px bg-gray-700 h-12"></div>
                        <div>
                            <div className="text-4xl font-black text-green-400">8.5+</div>
                            <div className="text-xs text-gray-500 uppercase font-bold">ЦЕЛЬ GRI</div>
                        </div>
                    </div>
                </div>

                {/* Right Column - Chart */}
                <div className="lg:col-span-2 bg-gray-900/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
                    <GriRadarChart data={DEMO_GRI_DATA} height={350} />
                    <div className="text-center mt-2 text-xs text-gray-500">
                        Сравнение: <span className="text-blue-400 font-bold">Ваш Бизнес</span> vs <span className="text-green-400 font-bold">Эталон $2M</span>
                    </div>
                </div>
            </section>

            {/* Red Zones Warning */}
            <div className="mt-8 text-center">
                <span className="text-red-400 text-sm font-bold uppercase tracking-wide">
                    🔴 КРАСНЫЕ ЗОНЫ - ЭТО РИСК
                </span>
            </div>

            {/* CTA */}
            <div className="mt-12 text-center space-y-4">
                <Link
                    href="/assessments/onboarding"
                    className="scarcity-banner inline-flex items-center gap-3 sm:gap-4 w-[max-content] flex-wrap justify-center bg-teal-500 hover:bg-teal-600 text-white px-4 py-3 sm:px-5 sm:py-3.5 rounded-xl shadow-lg hover:shadow-teal-500/40 transition-all duration-300 hover:scale-105 w-full sm:w-auto max-w-md sm:max-w-none"
                >
                    Пройти диагностику
                    <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                </Link>

                {/* Admin Link */}
                <div>
                    <Link href="/assessments/admin" className="text-gray-500 hover:text-teal-400 text-sm transition">
                        📊 Просмотр истории тестов →
                    </Link>
                </div>
            </div>
        </div>
    );
}
