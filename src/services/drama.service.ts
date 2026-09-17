import { DRAMA_DATABASE, DramaItem } from '../data/drama.data';

export class DramaService {
  public fetchAllDramas(): { success: boolean; total: number; data: DramaItem[] } {
    // Di sini tempat filter data / business logic kalau nanti mau ditambah
    return {
      success: true,
      total: DRAMA_DATABASE.length,
      data: DRAMA_DATABASE
    };
  }
}