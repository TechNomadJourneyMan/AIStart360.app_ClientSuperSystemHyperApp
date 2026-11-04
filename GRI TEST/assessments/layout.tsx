'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18nContext';

export default function AssessmentsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { t, lang, changeLang } = useTranslation();

    const menuItems = [
        { href: "/", label: t('nav.home') || "Главная" },
        { href: "/pricing", label: t('landing.tariffs_title') || "Тарифы" },
        { href: "/cases", label: t('landing.cases_title') || "Кейсы" },
        { href: "/assessments", label: "GRI Index" },
        { href: "/workshop/promo", label: "Workshop" },
    ];

    const whatsappLink = "https://api.whatsapp.com/send/?phone=77772301856&text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5,+%D0%9F%D0%B8%D1%88%D1%83+%D1%81+%D1%81%D0%B0%D0%B9%D1%82%D0%B0+Aistart360.&type=phone_number&app_absent=0";
    const bookingLink = "https://tidycal.com/istart/gtm";

    return (
        <div className="min-h-screen bg-black text-white selection:bg-teal-500/30">
            <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-md">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <Link href="/" className="flex items-center gap-2">
                        <span className="text-xl font-black tracking-tighter text-white">AIStart360</span>
                    </Link>

                    {/* Desktop Menu */}
                    <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
                        {menuItems.map(item => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`transition ${item.href === '/assessments' ? 'text-teal-400' : 'text-gray-400 hover:text-white'}`}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>

                    {/* Actions */}
                    <div className="flex items-center gap-4">
                        {/* Language Switcher */}
                        <div className="flex items-center bg-white/10 rounded-full p-0.5 text-xs font-semibold">
                            <button
                                onClick={() => changeLang('ru')}
                                className={`px-3 py-1 rounded-full transition ${lang === 'ru' ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                RU
                            </button>
                            <button
                                onClick={() => changeLang('en')}
                                className={`px-3 py-1 rounded-full transition ${lang === 'en' ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                EN
                            </button>
                        </div>

                        <a
                            href={whatsappLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-400 hover:text-green-300 transition hidden sm:block"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                            </svg>
                        </a>
                        <a
                            href={bookingLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hidden md:inline-flex px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold rounded-lg transition"
                        >
                            {t('nav.book_meeting') || 'Забронировать встречу'}
                        </a>
                    </div>
                </div>
            </header>
            <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 mx-auto max-w-4xl">
                {children}
            </main>
        </div>
    );
}