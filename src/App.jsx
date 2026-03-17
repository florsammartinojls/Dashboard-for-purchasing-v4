// ============================================================
// CAMBIO 1: SEMÁFORO — respetar filtros de Settings
// Buscar el useMemo de "sc" en App.jsx (~línea 73) y REEMPLAZAR:
// ============================================================

// VIEJO:
  const sc = useMemo(() => {
    const c = { critical: 0, warning: 0, healthy: 0 };
    (data.cores || []).forEach(x => { if (x.active !== "Yes") return; const v = (data.vendors || []).find(v => v.name === x.ven); c[gS(x.doc, v?.lt || 30, x.buf || 14, stg)]++ });
    return c;
  }, [data, stg]);

// NUEVO:
  const sc = useMemo(() => {
    const c = { critical: 0, warning: 0, healthy: 0 };
    (data.cores || []).forEach(x => {
      if (stg.fA === "yes" && x.active !== "Yes") return;
      if (stg.fA === "no" && x.active === "Yes") return;
      if (stg.fV === "yes" && x.visible !== "Yes") return;
      if (stg.fV === "no" && x.visible === "Yes") return;
      if (stg.fI === "blank" && !!x.ignoreUntil) return;
      if (stg.fI === "set" && !x.ignoreUntil) return;
      const v = (data.vendors || []).find(v => v.name === x.ven); c[gS(x.doc, v?.lt || 30, x.buf || 14, stg)]++
    });
    return c;
  }, [data, stg]);


// ============================================================
// CAMBIO 2: VENDORS TAB — respetar filtros de Settings
// Buscar la función VendorsTab y REEMPLAZAR el vS useMemo:
// ============================================================

// VIEJO:
  const vS = useMemo(() => {
    const g = {};
    (data.cores || []).filter(c => c.active === "Yes").forEach(c => {

// NUEVO:
  const vS = useMemo(() => {
    const g = {};
    (data.cores || []).filter(c => {
      if (stg.fA === "yes" && c.active !== "Yes") return false;
      if (stg.fA === "no" && c.active === "Yes") return false;
      if (stg.fV === "yes" && c.visible !== "Yes") return false;
      if (stg.fV === "no" && c.visible === "Yes") return false;
      if (stg.fI === "blank" && !!c.ignoreUntil) return false;
      if (stg.fI === "set" && !c.ignoreUntil) return false;
      return true;
    }).forEach(c => {
