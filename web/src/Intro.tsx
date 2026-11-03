import { useState } from 'react'

const CARDS = [
  {
    icon: '🎬',
    title: 'Кино на двоих',
    text: 'Сервис подбирает фильмы, которые понравятся вам обоим. Каждый рассказывает о своём вкусе, а дальше не нужно спорить, что смотреть вечером.',
  },
  {
    icon: '📝',
    title: 'Опрос',
    text: 'Фильмы показываются по одному. Смотрели — поставьте оценку от 1 до 10. Не смотрели — отметьте «хочу», «не знаю» или «не хочу». Первые 200 фильмов — база, дальше можно продолжать сколько угодно.',
  },
  {
    icon: '🧠',
    title: 'Сервис учится на ответах',
    text: '«Не хочу» и низкие оценки убирают похожие фильмы из очереди и рекомендаций. Высокие оценки и «хочу» подтягивают похожее ближе. Чем больше ответов, тем точнее подбор.',
  },
  {
    icon: '🍿',
    title: 'Что смотреть',
    text: 'Общий список для пары. «Прогноз» рядом с именем — оценка, которую этот человек, скорее всего, поставит фильму. Число справа — общий балл: он тянется к меньшему из прогнозов, чтобы никто не скучал.',
  },
  {
    icon: '👫',
    title: 'Вместе',
    text: 'Посмотрели фильм — отметьте его и сразу поставьте оценки обоим. Здесь же хранится история совместных просмотров. Кто не оценил, получит напоминание при следующем заходе.',
  },
  {
    icon: '📺',
    title: 'Фильмы и сериалы',
    text: 'Переключатель вверху опроса и рекомендаций выбирает, с чем вы работаете. У сериалов свой опрос и свои списки; оценки фильмов и сериалов помогают друг другу через любимые жанры и актёров.',
  },
  {
    icon: '🗂️',
    title: 'Мои фильмы и карточки',
    text: 'В «Моих фильмах» — все ваши ответы и поиск: любой фильм можно найти и оценить самому. Нажмите на постер, чтобы увидеть описание, актёров, страну и бюджет.',
  },
]

export default function Intro({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  const card = CARDS[i]
  const last = i === CARDS.length - 1
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6 pt-[calc(var(--safe-top)+1.5rem)]">
      <div key={i} className="space-y-4 rounded-2xl bg-zinc-900 p-6 text-center">
        <div className="text-5xl">{card.icon}</div>
        <h2 className="text-xl font-bold">{card.title}</h2>
        <p className="text-zinc-300">{card.text}</p>
      </div>
      <div className="flex justify-center gap-2">
        {CARDS.map((_, k) => (
          <button
            key={k}
            onClick={() => setI(k)}
            aria-label={`Карточка ${k + 1}`}
            className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-amber-400' : 'w-2 bg-zinc-700'}`}
          />
        ))}
      </div>
      <div className="flex gap-2">
        {i > 0 && (
          <button className="rounded-lg bg-zinc-800 px-4 py-2.5 text-zinc-200" onClick={() => setI(i - 1)}>
            Назад
          </button>
        )}
        <button className="flex-1 rounded-lg bg-amber-400 px-4 py-2.5 font-medium text-zinc-950" onClick={() => (last ? onDone() : setI(i + 1))}>
          {last ? 'Начать' : 'Далее'}
        </button>
      </div>
      {!last && (
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onDone}>
          Пропустить
        </button>
      )}
    </div>
  )
}
