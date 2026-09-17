export interface DramaItem {
  id: number;
  title: string;
  year: number;
  rating: number;
  genres: string[];
  status: string;
  cover: string;
  synopsis: string;
}

export const DRAMA_DATABASE: DramaItem[] = [
  {
    id: 1,
    title: 'Attack on Titan',
    year: 2013,
    rating: 9.1,
    genres: ['Action', 'Dark Fantasy', 'Mystery'],
    status: 'Completed',
    cover: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQigobSp1b1DRmp6xeC4hcycUCRnUXcP3XQTxdkHxd14w&s=10',
    synopsis: 'Umat manusia berlindung di balik tembok raksasa dari ancaman Titan. Suatu hari Tembok Maria jebol, memaksa Eren Yeager bersumpah memusnahkan seluruh Titan.'
  },
  {
    id: 2,
    title: 'Jujutsu Kaisen',
    year: 2020,
    rating: 8.6,
    genres: ['Action', 'Supernatural', 'Dark Fantasy'],
    status: 'Ongoing',
    cover: 'https://d28hgpri8am2if.cloudfront.net/book_images/onix/cvr9781974740819/jujutsu-kaisen-the-official-anime-guide-season-1-9781974740819_hr.jpg',
    synopsis: 'Yuji Itadori menelan jimat kutukan tingkat tinggi demi menyelamatkan temannya, menjadikannya wadah bagi Raja Kutukan, Ryomen Sukuna.'
  },
  {
    id: 3,
    title: 'Death Note',
    year: 2006,
    rating: 9.0,
    genres: ['Psychological', 'Thriller', 'Supernatural'],
    status: 'Completed',
    cover: 'https://m.media-amazon.com/images/M/MV5BYTgyZDhmMTEtZDFhNi00MTc4LTg3NjUtYWJlNGE5Mzk2NzMxXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg',
    synopsis: 'Light Yagami menemukan buku misterius milik Shinigami yang bisa membunuh siapa saja hanya dengan menuliskan namanya, memicu adu otak sengit melawan detektif jenius L.'
  },
  {
    id: 4,
    title: 'Cyberpunk: Edgerunners',
    year: 2022,
    rating: 8.3,
    genres: ['Sci-Fi', 'Action', 'Cyberpunk'],
    status: 'Completed',
    cover: 'https://thumb.wikimedia.org/wikipedia/en/thumb/a/a1/Cyberpunk_Edgerunners_poster.jpg/250px-Cyberpunk_Edgerunners_poster.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail',
    synopsis: 'Seorang anak jalanan berusaha bertahan hidup di kota dystopia Night City yang terobsesi dengan teknologi dan modifikasi tubuh dengan menjadi mercenaries/Edgerunner.'
  },
  {
    id: 5,
    title: 'Naruto: Classic',
    year: 2002,
    rating: 8.4,
    genres: ['Action', 'Adventure', 'Shonen'],
    status: 'Completed',
    cover: 'https://m.media-amazon.com/images/M/MV5BZTNjOWI0ZTAtOGY1OS00ZGU0LWEyOWYtMjhkYjdlYmVjMDk2XkEyXkFqcGc@._V1_.jpg',
    synopsis: 'Naruto Uzumaki, bocah yatim piatu wadah Rubah Ekor Sembilan, dikucilkan warga Konoha. Demi diakui, ia bertekad jadi Hokage dan berjuang menjalankan misi berbahaya bersama Tim 7.'
  }
];