import type { PoolClient } from "pg";

/**
 * Bir e-posta ya öğretmen ya öğrencidir. Hesaba rol kazandıran işlemler
 * (çalışma alanı açmak, öğrenci davetini kabul etmek, ders isteğinin kabulü)
 * rol kontrolünden önce bu kilidi alır. Aynı hesap için eşzamanlı iki işlem
 * sıraya girer; ikincisi birincinin sonucunu görerek karar verir.
 */
export async function lockAccountRole(tx: PoolClient, userId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "role:" + userId,
  ]);
}
