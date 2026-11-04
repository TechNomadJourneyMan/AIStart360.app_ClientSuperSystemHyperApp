'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { GRI_SECTIONS } from '../data/sections';

export default function OverviewPage() {
    const [assessmentId, setAssessmentId] = useState<string | null>(null);
    const [lockedSections, setLockedSections] = useState(0);
    
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const id = window.localStorage.getItem('gri_current_assessment_id');
            setAssessmentId(id);
            
            if (id) {
                let lastComp =  0;
                GRI_SECTIONS.forEach((section, index) => {
                    const isStepFinished = window.localStorage.getItem(`gri_section_${section.id}_completed`);
                    if (isStepFinished === 'true') {
                        lastComp = index + 1;
                    } 
                })
                setLockedSections(lastComp);
            } else {
                setLockedSections(0);
            }

        }


    }, []);

    return (
        <div className="animate-fadeIn pb-20">
            <div className="mb-10 text-center">
                <h1 className="text-3xl font-bold mb-4 text-teal-500">Оценка GRI Index </h1>
                <p className="text-gray-400 max-w-xl mx-auto">
                    Пройдите 7 блоков GRI Index и получите оценку готовности к росту $2M/год


                </p>
            </div>

            <div className="grid gap-4">
                {GRI_SECTIONS.map((section, index) => {

                    const Islocked = index > lockedSections;
                    if (Islocked) return null;
                    return  (
                        
                    
                        
                    <Link
                        key={section.id}
                        href={Islocked ? '#' : `/assessments/${section.id}`}
                        onClick={(e) => {
                            if (Islocked) {
                                    e.preventDefault();
                                    alert('извините но вы не можете переходить к следующему блоку');
                            }

                            if (!assessmentId) {
                                    e.preventDefault();
                                    alert('Сначала пройдите регистрацию');
                            }
                            }}
                        className={Islocked ? 'cursor-not-allowed' : 'cursor-pointer'}
                     >
                        <div className={`group bg-gray-900/50 border border-white/10 p-6 rounded-xl backdrop-blur-sm hover:border-teal-500/50 transition-all cursor-pointer `}>

                            <div className="flex items-center justify-between">
                                <div>
                                    <div className={`text-xs font-bold mb-1 uppercase tracking-wide ${Islocked ? 'text-gray-500' : 'text-teal-400'}`}> 
                                        Блок {index + 1}
                                    </div>
                                    <h3 className="text-xl font-bold group-hover:text-teal-300 transition-colors">
                                        {section.title}
                                    </h3>
                                    <p className="text-gray-500 text-sm mt-1">
                                        {section.description}
                                    </p>
                                </div>
                                <div className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 group-hover:bg-teal-500 group-hover:text-black transition-all">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                           </Link>
                    );
                })}
            </div>

            <div className="mt-10 text-center">
                <Link
                    href={assessmentId ? `/assessments/${GRI_SECTIONS[0].id}` : '#'}
                    className="scarcity-banner inline-flex items-center gap-3 sm:gap-4 flex-wrap justify-center bg-teal-500 hover: bg-teal-600 text-black font-bold text-lg px-4 py-3 sm:px-5 sm:py-3.5 rounded-xl shadow-lg hover:shadow-teal-500/40 transition-all duration-300 hover:scale-105 w-[200px] sm:w-auto max-w-md sm:max-w-none"
                >
                    Начать
                </Link>
            </div>
        </div>
    );
}
