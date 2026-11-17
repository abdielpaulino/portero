import { db } from "../db/client.js";
import { lojas } from "../db/schema.js";
import type { LojaConectada } from "./oauth.js";

export interface NuvemshopRepository {
  salvarLoja(loja: LojaConectada): Promise<void>;
}

export const nuvemshopRepository: NuvemshopRepository = {
  async salvarLoja(loja) {
    await db.insert(lojas).values(loja).onConflictDoUpdate({
      target: lojas.nuvemshopStoreId,
      set: { accessToken: loja.accessToken, scope: loja.scope, nomeLoja: loja.nomeLoja },
    });
    // A instalação não concede acesso ao PORTERO nem deve mudar o status de uma loja existente.
  },
};
