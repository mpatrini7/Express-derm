# Express-Derm — campione challenge da 30 immagini

Questo pacchetto serve a mostrare in modo ripetibile i tre stati dell'interfaccia
con `express-derm-v0.3.1` e la policy `binary-extremes-v1`:

- `01_low_benigni`: 10 lesioni benigne confermate istologicamente, attese `Low`;
- `02_inconclusive_misti`: 5 lesioni benigne e 5 melanomi, tutti confermati
  istologicamente, attesi `Inconclusive`;
- `03_high_melanomi`: 10 melanomi confermati istologicamente, attesi `High`.

Le immagini sono CC0 e provengono da snapshot locali delle collezioni ISIC 294
e MSK-1 289. Ogni file appartiene a un paziente e a una lesione distinti; nessun
ID compare nel manifest di addestramento del modello corrente o nel precedente
campione demo. Fonte, licenza, attribuzione, hash e metadati sono conservati in
`manifest.csv` e `metadata_source_snapshot.json`.

Le sorgenti ad alta risoluzione sono state ridimensionate senza ritaglio a un
massimo di 1024 pixel e salvate in JPEG qualità 95. Questa normalizzazione rende
il formato confrontabile con l'acquisizione prevista dal quality gate. Tutti i
30 JPEG finali superano il quality gate e mantengono lo stesso stato anche con
ribaltamento orizzontale, verticale o doppio.

## Avvertenza essenziale

Il campione è stato selezionato deliberatamente osservando gli output di
Express-Derm. È quindi una fixture dimostrativa per la challenge, non un test
cieco e non una misura di accuratezza, validazione clinica o capacità
diagnostica. Il modello rimane `research_only` e la validazione sul dominio del
microscopio è ancora pendente. Il dettaglio completo della selezione è in
`selection_receipt.json`.

Per controllare integrità, qualità e composizione:

```bash
make demo-check
```

Nell'app selezionare **Carica file** e usare direttamente uno dei JPEG delle tre
cartelle. L'immagine deve essere associata a una lesione prima di richiedere la
valutazione AI.
