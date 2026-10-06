# Suivi des ordres — mod Cookie Clicker (conception)

Date : 2026-10-01
Statut : validé à l'oral, en relecture écrite

## Objectif

Un mod Cookie Clicker (version Steam) **autonome**. Il ajoute à la Bourse (le mini-jeu des Banques) un onglet « Portefeuille », inspiré de l'application [Suivi des ordres](https://github.com/Akmot9/actions_true_perf) :

- chaque achat est un **lot** ;
- les ventes sont comptées **en FIFO** (du plus ancien lot au plus récent) ;
- les frais sont répartis **au prorata** ;
- le **réalisé** et le **latent** sont séparés.

Réussite : le joueur voit à tout moment ce que chaque marchandise lui a coûté, ce qu'elle vaut, ce qu'il a déjà gagné ou perdu, et d'où vient le résultat, sans chiffre inventé.

## Hors sujet

- Conseils d'achat ou de vente automatiques. Les alertes restent dans l'outil de coaching externe.
- Graphiques d'historique.
- Traduction anglaise. Les textes sont en français, regroupés dans une seule table.
- Toute dépendance à Coach Claude Cookie. Les deux mods fonctionnent l'un sans l'autre.

## Contraintes vérifiées dans le jeu

- Mod Steam : un dossier dans `mods/local/` avec `info.txt` et `main.js`, et `Game.registerMod(id, {init, save, load})`. `"AllowSteamAchievs": 1`.
- Bourse : `Game.Objects.Bank.minigame` (désigné M ci-dessous).
  - `M.goodsById[i]` a les champs `name` (déjà traduit), `symbol`, `val` (prix en $), `stock`, `mode`, `active` et `hidden`.
  - `M.getRestingVal(id)` donne la valeur de repos.
  - `M.getGoodMaxStock(good)` donne le stock maximum.
  - `M.brokers` est le nombre de courtiers.
- Achat : `M.buyGood(id, n)` renvoie `true` ou `false`. Le prix payé par unité vaut `val × (1 + 0,2 × 0,95^courtiers)`, en $.
- Vente : `M.sellGood(id, n)`, sans frais.
- 1 $ = `Game.cookiesPsRawHighest` cookies : la production brute maximale de la partie, sans les bonus temporaires.
- Interface : chaque bâtiment a une ligne `#row<id>`, et `Bank.id` vaut 5. Les boutons de la ligne sont dans `#row5 .productButtons`. Le mod jardin (CGHR) ajoute de la même façon un bouton `productButton` et un panneau dans la ligne de la Ferme.

## Modèle : le registre (`Ledger`, logique pure)

```
lots[goodId] = [{ t, qty, unitPrice, unitFee }]   // qty restante ; unitPrice et unitFee en $ par unité
realized[goodId] = { proceeds, cost, fees }        // cumul des ventes : produit, coût FIFO, frais alloués
unknown[goodId] = qty                              // stock présent avant le suivi, de coût inconnu
```

- `buy(id, qty, val, overhead, t)` ajoute un lot avec `unitPrice = val` et `unitFee = val × (overhead − 1)`.
- `sell(id, qty, val, t)` consomme d'abord le stock **inconnu**, qui n'entre pas dans le P/L, puis les lots en FIFO :
  - `proceeds += qty_vendue_connue × val` ;
  - `cost += Σ qty × unitPrice` ;
  - `fees += Σ qty × unitFee`.

  Un lot partiellement vendu garde ses valeurs unitaires : ses frais restants suivent donc mécaniquement le prorata.
- `reconcile(id, stockDuJeu)` sert au démarrage ou si le stock du jeu diffère du registre (achats faits sans le mod) :
  - si le jeu en a **plus**, la différence va dans `unknown` ;
  - si le jeu en a **moins**, la différence est retirée de `unknown`, puis des lots en FIFO, **sans** compter de P/L réalisé, car la vente n'a pas été vue.
- Calculs par marchandise, au cours `val` :
  - `qtyKnown = Σ lots.qty` ;
  - `capital = Σ qty × (unitPrice + unitFee)` ;
  - `valeur = qtyKnown × val` ;
  - `latent = valeur − capital` ;
  - `realise = proceeds − cost − fees` ;
  - `pru = capital / qtyKnown` (prix de revient unitaire).
- Les totaux additionnent toutes les marchandises. Les quantités inconnues comptent dans la quantité détenue et dans la valeur de marché (`valueAll`), mais jamais dans le capital ni dans le P/L. *(Révisé après retour du joueur : afficher « 0 » pour un stock détenu était trompeur.)*
- Sauvegarde : `save()` renvoie le registre en JSON compact (lots, réalisé, inconnu), et `load()` le recharge. Si le contenu est invalide, le registre repart vide, puis `reconcile` replace tout le stock en inconnu.

## Interface

- Un bouton **« Portefeuille »** (`productButton`) est ajouté une fois dans `#row5 .productButtons`, dès que la Bourse existe. Un clic affiche ou masque le panneau `#sdoPanel`, placé à la fin de `#row5`.
- **Résumé en haut** : valeur de marché, capital investi, P/L latent, P/L réalisé et frais payés. Chaque montant est en $ et en cookies, avec l'échelle courte du jeu (M, B, T, Qa).
- **Un tableau, une ligne par marchandise active :**
  - colonnes : quantité (avec, s'il existe, `+N coût inconnu`), stock max, PRU, cours, écart au repos (signé, coloré du rouge au vert), valeur, P/L latent ($ et %), P/L réalisé ;
  - le latent et le réalisé sont en vert s'ils sont positifs, en rouge s'ils sont négatifs.
- **Clic sur une ligne** : la liste de ses lots se déplie (heure, quantité restante, prix, frais, P/L latent du lot).
- Rafraîchissement **seulement quand le panneau est ouvert** : une fois par seconde, et juste après chaque achat ou vente. Le HTML n'est réécrit que s'il a changé.
- Aucun émoji ni symbole hors Latin-1, car le jeu ne les affiche pas. Tous les textes passent par `esc()`.

## Architecture du code

```
mod/info.txt       ID "suivi des ordres"
mod/main.js        Ledger (pur) + render (pur, renvoie du HTML) + install (enveloppe buy/sell, bouton, panneau)
test/*.test.js     node:test
README.md
```

- `install(game, doc, ledger)` :
  - enveloppe `buyGood` et `sellGood` une seule fois, avec une marque `__sdoWrapped`, et réessaie chaque seconde tant que la Bourse n'existe pas ;
  - ajoute le bouton et le panneau ;
  - réconcilie le stock à chaque seconde.
- Chaque enveloppe appelle toujours la fonction d'origine et renvoie sa valeur. Les erreurs du mod sont attrapées et ne coupent que le mod.
- Le registre est exposé dans `Game.mods['suivi des ordres'].ledger`, pour que d'autres outils puissent le lire.

## Intégration avec Coach Claude Cookie

Le prix moyen calculé par Coach Claude Cookie est retiré. Son fichier en direct inclut à la place, s'il est présent, le résumé du registre de Suivi des ordres (`Game.mods['suivi des ordres']`). Ce sera un petit changement séparé, fait après ce mod.

## Tests

- **Ledger** :
  - achat, puis vente partielle FIFO sur plusieurs lots ;
  - frais au prorata ;
  - réalisé et latent ;
  - stock inconnu, vendu en premier ;
  - `reconcile` dans les deux sens ;
  - aller-retour de sauvegarde, et sauvegarde invalide.
- **render** : textes français, couleurs selon le signe, coût inconnu affiché à part, échappement HTML, lots dépliés.
- **install**, avec un faux jeu et un faux DOM :
  - le bouton est ajouté une seule fois et ouvre ou ferme le panneau ;
  - un achat ou une vente passé par les fonctions du jeu met à jour le registre ;
  - un achat refusé (`false`) ne change rien ;
  - la Bourse arrivée en retard est prise en compte ;
  - pas de document : ne fait rien.
- **En jeu** : le bouton apparaît sur la ligne des Banques, les chiffres correspondent à ceux de la Bourse, et le registre survit à un redémarrage.

## Publication

Dépôt public `Akmot9/cookie-suivi-des-ordres`, installé par lien symbolique dans `mods/local/suivi des ordres`.
