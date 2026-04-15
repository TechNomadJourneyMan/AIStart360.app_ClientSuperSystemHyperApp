'use client'

import { useRef, useState } from 'react'
import styles from './GriPulsePage.module.css'

export default function GriPulsePage() {
  const [calcClients, setCalcClients] = useState(200)
  const [calcCheck, setCalcCheck] = useState(500000)
  const [calcMissed, setCalcMissed] = useState(40)
  const audioRefs = useRef<Array<HTMLAudioElement | null>>([])

  const calcResult = calcMissed * calcCheck

  const bookingLink = 'https://tidycal.com/istart/gtm'
  const whatsappLink =
    'https://api.whatsapp.com/send/?phone=77772301856&text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5,+%D0%9F%D0%B8%D1%88%D1%83+%D1%81+%D1%81%D0%B0%D0%B9%D1%82%D0%B0+GRI+Pulse.'

  const audioTracks = [
    { title: 'Часть 1 — Введение', src: '/gri-pulse-audio/Base_1.m4a' },
    { title: 'Часть 2 — Формула потерянной выручки', src: '/gri-pulse-audio/Base_2.m4a' },
    { title: 'Часть 3 — Как выглядит идеальная база', src: '/gri-pulse-audio/Base_3.m4a' },
    { title: 'Часть 4 — Как база влияет на выручку', src: '/gri-pulse-audio/Base_4.m4a' },
    { title: 'Часть 5 — Механика сбора данных', src: '/gri-pulse-audio/Base_5.m4a' },
    { title: 'Часть 6 — Снижаем человеческий фактор', src: '/gri-pulse-audio/Base_6.m4a' },
    { title: 'Часть 7 — Решение GRI Pulse', src: '/gri-pulse-audio/Base_7.m4a' },
    { title: 'Часть 8 — Как мы работаем?', src: '/gri-pulse-audio/Base_8.m4a' },
  ]

  const levers = [
    { icon: '🔁', num: 'I', title: 'Повторные продажи', desc: '×2–4 vs разовая продажа' },
    { icon: '📈', num: 'II', title: 'Допродажи', desc: '+15–40% к среднему чеку' },
    { icon: '💤', num: 'III', title: 'Реактивация спящих', desc: '68% возвращаются' },
    { icon: '⚡', num: 'IV', title: 'Частота покупок', desc: '×3 выручки с клиента' },
    { icon: '💰', num: 'V', title: 'Рост среднего чека', desc: '+30–50% к чеку' },
    { icon: '🛡️', num: 'VI', title: 'Удержание', desc: '−10% отток → +25% выручки' },
  ]

  const clientCardSections = [
    { num: '01', title: 'Портрет', desc: 'Сегмент, отрасль, модель закупки, цикл решений, LTV, частота, потенциал' },
    { num: '02', title: 'Контекст', desc: 'Записи звонков, возражения, обещания, вопросы клиента, что беспокоит' },
    { num: '03', title: 'Каналы', desc: 'WhatsApp, почта, встречи, мессенджеры — полная история касаний' },
    { num: '04', title: 'Материалы', desc: 'КП, бриф, расчёты, тендерные документы, персональные офферы' },
    { num: '05', title: 'Воронка', desc: 'Стадия, следующий шаг, дата контакта, вероятность, причина задержки' },
    { num: '06', title: 'Поведение', desc: 'Что читал, скачивал, на что реагировал, где замолчал, сигналы интереса' },
    { num: '07', title: 'Наблюдения', desc: 'Неформальные заметки, истинные мотивы, политическая карта, кто влияет' },
  ]

  const processSteps = [
    { num: '01', title: 'Разбираем базу', desc: 'Анализ текущей структуры данных, первые инсайты по сегментам и рискам' },
    { num: '02', title: 'Настраиваем систему', desc: 'Интеграция с вашей CRM или Excel, настройка метрик и дашборда' },
    { num: '03', title: 'Обучаем команду', desc: 'Менеджеры понимают, кому звонить и с каким сообщением — каждый день' },
    { num: '04', title: 'Сопровождаем рост', desc: 'Еженедельные отчёты, стратегический разбор раз в месяц, поддержка 24/7' },
  ]

  const tableRows = [
    { name: 'Stark Industries',    lastOrder: '26 дн',  check: '3 400 000', change: '+8%',  score: 91, risk: 'Высокий · 85%', comment: 'Менеджер не звонит 18...',     action: 'Позвонить' },
    { name: 'Oscorp',              lastOrder: '15 дн',  check: '1 330 000', change: '−49%', score: 92, risk: 'Высокий · 85%', comment: 'Не отвечает на WhatsApp',     action: 'Позвонить' },
    { name: 'Wayne Enterprises',   lastOrder: '10 дн',  check: '680 000',   change: '−18%', score: 82, risk: 'Высокий · 76%', comment: 'Снизился паттерн — ра...',    action: 'Позвонить' },
    { name: 'Pym Technologies',    lastOrder: '18 дн',  check: '1 160 000', change: '−40%', score: 64, risk: 'Средний · 56%', comment: 'Откладывает встречу 2...',    action: 'Позвонить' },
    { name: 'Rand Corporation',    lastOrder: '22 дн',  check: '420 000',   change: '−13%', score: 33, risk: 'Средний · 3%',  comment: 'Снижает частоту заказ...',    action: 'Написать' },
    { name: 'Wakanda Tech',        lastOrder: '5 дн',   check: '3 290 000', change: '+6%',  score: 22, risk: 'Низкий · 9%',   comment: 'Всё в норме, плановый...',    action: 'Мониторинг' },
  ]

  const results = [
    { icon: '🟠', title: 'Кто готов купить сейчас',  desc: 'Список клиентов и сделок, близких к оплате.' },
    { icon: '🔴', title: 'Кто под риском ухода',      desc: 'Клиенты, которых можно потерять без быстрого действия.' },
    { icon: '💸', title: 'Где теряются деньги',       desc: 'Сделки без движения, пропущенные шаги и забытые follow-up.' },
    { icon: '📊', title: 'Потенциал базы в цифрах',   desc: 'Сколько денег в базе реально в работе, сколько заморожено.' },
  ]

  return (
    <div className={styles.page}>
      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroBadge}>
          <span>AISTART360</span>
          <span className={styles.heroBadgeDot}>✦</span>
          <span>GRI PULSE</span>
        </div>
        <h1 className={styles.heroTitle}>
          Сколько денег вы теряете в<br />
          клиентской базе{' '}
          <span className={styles.heroTitleAccent}>прямо<br />сейчас?</span>
        </h1>
        <p className={styles.heroSubtitle}>Разберем, как в один клик получать данные и обеспечить рост выручки:</p>
        <div className={styles.heroStats}>
          <div className={styles.heroStatItem}>
            <ul className={styles.heroStatList}>
              <li>кому сегодня продавать</li>
              <li>какие клиенты в зоне риска — отвалят и уйдут к конкурентам</li>
              <li>кто те самые 20% компаний, на кого следует сделать основной упор</li>
            </ul>
          </div>
          <div className={styles.heroStatNumbers}>
            <div className={styles.heroStatNumber}>
              <span className={styles.heroStatBig}>5–8×</span>
              <span className={styles.heroStatLabel}>дешевле удержание<br />и привлечение</span>
            </div>
            <div className={styles.heroStatNumber}>
              <span className={styles.heroStatBig}>68%</span>
              <span className={styles.heroStatLabel}>«спящих» клиентов<br />возвращаются</span>
            </div>
            <div className={styles.heroStatNumber}>
              <span className={styles.heroStatBig}>24/7</span>
              <span className={styles.heroStatLabel}>мониторинг базы<br />без выходных</span>
            </div>
          </div>
        </div>
        <div className={styles.heroCtas}>
          <a href={bookingLink} target="_blank" rel="noopener noreferrer" className={styles.btnPrimary}>
            Разобрать мою базу →
          </a>
          <a href="#solution" className={styles.btnSecondary}>Посмотреть пример разбора</a>
        </div>
        <div className={styles.heroInfographic}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gri-pulse-assets/base_map_2-YXnMnOG3.png" alt="GRI Pulse система роста" className={styles.heroInfographicImg} />
        </div>
      </section>

      {/* Audio Lessons */}
      <section className={styles.audioSection}>
        <div className={styles.container}>
          <div className={styles.audioGrid}>
            {audioTracks.map((track, i) => (
              <div key={i} className={styles.audioCard}>
                <span className={styles.audioTitle}>{track.title}</span>
                <audio
                  ref={(el) => { audioRefs.current[i] = el }}
                  controls
                  preload="none"
                  className={styles.audioPlayer}
                >
                  <source src={track.src} type="audio/mp4" />
                </audio>
              </div>
            ))}
          </div>

          <div className={styles.bookingCta}>
            <div className={styles.bookingCtaIcon}>📅</div>
            <h3 className={styles.bookingCtaTitle}>Забронируй время для онлайн-встречи</h3>
            <p className={styles.bookingCtaDesc}>Получи чек-лист ведения базы и роста ежедневной выручки</p>
            <a href={bookingLink} target="_blank" rel="noopener noreferrer" className={styles.btnOrange}>
              Забронировать встречу →
            </a>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className={styles.problemSection}>
        <div className={styles.container}>
          <p className={styles.sectionLabel}>ПРОБЛЕМА</p>
          <h2 className={styles.sectionTitle}>
            Вы платите за новых клиентов,<br />пока старые уходят к конкурентам
          </h2>
          <div className={styles.problemStats}>
            <div className={styles.problemStatCard}>
              <span className={styles.problemStatBig}>6–24 млн ₸</span>
              <span className={styles.problemStatDesc}>потеря в год от ухода 1 клиента с чеком 500 000–2 000 000 ₸/мес</span>
            </div>
            <div className={styles.problemStatCard}>
              <span className={styles.problemStatBig}>50–100</span>
              <span className={styles.problemStatDesc}>касаний нужно, чтобы привлечь 1 нового B2B-клиента</span>
            </div>
            <div className={styles.problemStatCard}>
              <span className={styles.problemStatBig}>5 из 100</span>
              <span className={styles.problemStatDesc}>лидов становятся сделками при конверсии 5%</span>
            </div>
          </div>
          <div className={styles.problemPotential}>
            <p className={styles.problemPotentialLabel}>СКРЫТЫЙ ПОТЕНЦИАЛ ВАШЕЙ БАЗЫ</p>
            <div className={styles.problemPotentialCards}>
              <div className={styles.problemPotentialCard}>
                <span className={styles.problemPotentialBig}>28 млн ₸</span>
                <span className={styles.problemPotentialDesc}>потенциал, если 20% из 200 клиентов готовы купить повторно при среднем чеке 700 000 ₸</span>
              </div>
              <div className={styles.problemPotentialCard}>
                <span className={styles.problemPotentialBig}>4–12 млн ₸</span>
                <span className={styles.problemPotentialDesc}>риск потерь, если база из 100 компаний не управляется</span>
              </div>
            </div>
          </div>
          <div className={styles.problemCallout}>
            Ваша база — либо <span className={styles.calloutGreen}>актив</span>, либо{' '}
            <span className={styles.calloutRed}>ежедневная утечка денег</span>
          </div>
        </div>
      </section>

      {/* Calculator */}
      <section id="calculator" className={styles.calculatorSection}>
        <div className={styles.container}>
          <p className={styles.sectionLabel}>КАЛЬКУЛЯТОР</p>
          <h2 className={styles.sectionTitle}>Сколько денег в вашей базе?</h2>
          <div className={styles.calculator}>
            <div className={styles.calcGroup}>
              <label className={styles.calcLabel}>КОЛИЧЕСТВО КЛИЕНТОВ</label>
              <input type="number" value={calcClients} onChange={(e) => setCalcClients(Number(e.target.value))} className={styles.calcInput} />
            </div>
            <div className={styles.calcGroup}>
              <label className={styles.calcLabel}>СРЕДНИЙ ЧЕК (₸)</label>
              <input type="number" value={calcCheck} onChange={(e) => setCalcCheck(Number(e.target.value))} className={styles.calcInput} />
            </div>
            <div className={styles.calcGroup}>
              <label className={styles.calcLabel}>КЛИЕНТЫ С ПРОПУЩЕННЫМ ЦИКЛОМ</label>
              <input type="number" value={calcMissed} onChange={(e) => setCalcMissed(Number(e.target.value))} className={styles.calcInput} />
            </div>
            <div className={styles.calcResult}>
              <p className={styles.calcResultLabel}>КЛИЕНТЫ С ПРОПУЩЕННЫМ ЦИКЛОМ × СРЕДНИЙ ЧЕК</p>
              <p className={styles.calcResultValue}>{calcResult.toLocaleString('ru-RU')} ₸</p>
              <p className={styles.calcResultDesc}>деньги, которые уже лежат в вашей базе</p>
              <p className={styles.calcResultNote}>В большинстве компаний это 5–20 млн ₸</p>
            </div>
          </div>
        </div>
      </section>

      {/* Solution — 6 Levers */}
      <section id="solution" className={styles.solutionSection}>
        <div className={styles.container}>
          <p className={styles.sectionLabel}>РЕШЕНИЕ</p>
          <h2 className={styles.sectionTitle}>6 рычагов монетизации базы</h2>
          <p className={styles.sectionSubtitle}>
            GRI Pulse + Reorder Signal каждый день показывает, где деньги — и что делать прямо сейчас.
          </p>
          <div className={styles.leversGrid}>
            {levers.map((lever, i) => (
              <div key={i} className={styles.leverCard}>
                <span className={styles.leverIcon}>{lever.icon}</span>
                <div>
                  <span className={styles.leverNum}>{lever.num}.</span>
                  <span className={styles.leverTitle}> {lever.title}</span>
                  <p className={styles.leverDesc}>{lever.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ideal Base — Client Card */}
      <section className={styles.clientCardSection}>
        <div className={styles.container}>
          <p className={styles.sectionLabel}>ПРИМЕР</p>
          <h2 className={styles.sectionTitle}>Идеальная база помогает принимать решения</h2>
          <p className={styles.sectionSubtitle}>
            Так выглядит карточка клиента в системе GRI Pulse — полная картина для принятия решений
          </p>
          <div className={styles.clientCardAccordion}>
            {clientCardSections.map((section, i) => (
              <div key={i} className={styles.clientCardRow}>
                <div className={styles.clientCardHeader}>
                  <span className={styles.clientCardNum}>{section.num}</span>
                  <span className={styles.clientCardTitle}>{section.title}</span>
                </div>
                <p className={styles.clientCardDesc}>{section.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lead Magnet CTA */}
      <section className={styles.leadMagnet}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>
            Скачайте пример<br />идеальной CRM-базы
          </h2>
          <p className={styles.sectionSubtitle}>10 готовых карточек клиентов с правильной структурой данных</p>
          <form className={styles.leadForm} onSubmit={(e) => { e.preventDefault(); window.open(bookingLink, '_blank') }}>
            <input type="text" placeholder="Ваше имя" className={styles.leadInput} required />
            <input type="tel" placeholder="+7" className={styles.leadInput} required />
            <button type="submit" className={styles.btnOrange}>⬇️ Скачать шаблон</button>
          </form>
        </div>
      </section>

      {/* Dashboard Mockup */}
      <section className={styles.dashboardSection}>
        <div className={styles.container}>
          <p className={styles.sectionLabel}>ДАШБОРД</p>
          <h2 className={styles.sectionTitle}>Так выглядит ваш монитор клиентской базы</h2>
          <p className={styles.sectionSubtitle}>GRI Pulse показывает кому звонить, кто уходит, и где деньги — каждый день</p>
          <div className={styles.dashboardFullMockup}>
            <div className={styles.dashFullHeader}>
              <span className={styles.dashFullBrand}>GRI Pulse ✦</span>
              <span className={styles.dashFullTariff}>Стартер · до 100 клиентов</span>
            </div>
            <div className={styles.dashFullStats}>
              <div><span>ВЫРУЧКА ПОД УГРОЗОЙ</span><strong>4 260 000 ₸</strong></div>
              <div><span>ВЫСОКИЙ РИСК</span><strong className={styles.textRed}>3 клиента</strong></div>
              <div><span>СРЕДНИЙ РИСК</span><strong className={styles.textOrange}>4 клиента</strong></div>
              <div><span>ВСЕГО КЛИЕНТОВ</span><strong>28</strong></div>
              <div><span>ОБРАБОТАНО СЕГОДНЯ</span><strong>2 / 7</strong></div>
            </div>
            <div className={styles.dashFullTabs}>
              <span className={`${styles.dashTab} ${styles.dashTabActive}`}>Кому продавать сегодня ⓘ</span>
              <span className={styles.dashTab}>Топ в зоне риска 16</span>
              <span className={styles.dashTab}>Карточка клиента</span>
            </div>
            <div className={styles.dashFullAlert}>
              <span className={styles.dotRed}></span>
              3 клиента просрочили цикл заказа более чем на 10 дней. Возможная потеря: <strong>4 260 000 ₸</strong> в этом месяце.
            </div>
            <table className={styles.dashTable}>
              <thead>
                <tr>
                  <th>КЛИЕНТ</th>
                  <th>ПОСЛЕДНИЙ ЗАКАЗ</th>
                  <th>СР. ЧЕК</th>
                  <th>ИЗМЕНЕНИЕ ОБЪЕМА</th>
                  <th>РИСК-СКОР</th>
                  <th>ВЕРОЯТНОСТЬ ОТТОКА</th>
                  <th>КОММЕНТАРИЙ</th>
                  <th>ДЕЙСТВИЕ</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={i}>
                    <td>+ {row.name}</td>
                    <td>{row.lastOrder}</td>
                    <td>{row.check} ₸</td>
                    <td className={row.change.startsWith('+') ? styles.textGreen : styles.textRed}>{row.change}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: 40, height: 6, background: '#fee2e2', borderRadius: 3 }}>
                          <div style={{ width: `${row.score}%`, height: '100%', background: '#ef4444', borderRadius: 3 }} />
                        </div>
                        {row.score}
                      </div>
                    </td>
                    <td>{row.risk}</td>
                    <td>{row.comment}</td>
                    <td><button className={styles.actionBtn}>{row.action}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className={styles.resultsSection}>
        <div className={styles.container}>
          <p className={styles.sectionLabel}>РЕЗУЛЬТАТ</p>
          <h2 className={styles.sectionTitle}>Что вы получите при внедрении GRI Pulse</h2>
          <p className={styles.sectionSubtitle}>
            За 3 дня — запуск системы, анализ базы и первые выводы по данным, рискам и точкам роста
          </p>
          <div className={styles.resultsList}>
            {results.map((r, i) => (
              <div key={i} className={styles.resultItem}>
                <span className={styles.resultIcon}>{r.icon}</span>
                <div>
                  <strong>{r.title}</strong>
                  <p>{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className={styles.pricingSection}>
        <div className={styles.container}>
          <p className={styles.sectionLabel}>ЦЕНА</p>
          <h2 className={styles.sectionTitle}>Специальное предложение</h2>
          <div className={styles.pricingCard}>
            <div className={styles.pricingBadge}>🔥 Ограниченное предложение</div>
            <div className={styles.pricingPrice}>
              <span className={styles.pricingOld}>120 000 ₸</span>
              <span className={styles.pricingNew}>
                80 000 ₸<span className={styles.pricingPer}>/мес</span>
              </span>
            </div>
            <ul className={styles.pricingFeatures}>
              <li>✅ Анализ клиентской базы</li>
              <li>✅ Еженедельные отчёты и дашборд</li>
              <li>✅ Обучение команды</li>
              <li>✅ Ежемесячный стратегический отчёт</li>
              <li>✅ Запуск за 3 дня</li>
            </ul>
            <a href={bookingLink} target="_blank" rel="noopener noreferrer" className={styles.btnOrangeLarge}>
              Забронировать встречу →
            </a>
          </div>
        </div>
      </section>

      {/* Process */}
      <section className={styles.processSection}>
        <div className={styles.container}>
          <p className={styles.sectionLabel}>КАК МЫ РАБОТАЕМ</p>
          <h2 className={styles.sectionTitle}>4 шага к системному росту</h2>
          <div className={styles.processGrid}>
            {processSteps.map((step, i) => (
              <div key={i} className={styles.processCard}>
                <span className={styles.processNum}>{step.num}</span>
                <h3 className={styles.processTitle}>{step.title}</h3>
                <p className={styles.processDesc}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.finalCta}>
        <div className={styles.container}>
          <h2 className={styles.finalCtaTitle}>
            Готовы узнать, сколько денег<br />лежит в вашей базе?
          </h2>
          <p className={styles.finalCtaSubtitle}>Разберём вашу базу и покажем потенциал за 60 минут</p>
          <a href={bookingLink} target="_blank" rel="noopener noreferrer" className={styles.btnOrangeLarge}>
            Разобрать мою базу →
          </a>
        </div>
      </section>

      {/* Floating WhatsApp */}
      <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className={styles.floatingWa}>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
        <span>Написать в WhatsApp</span>
      </a>
    </div>
  )
}
