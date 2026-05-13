'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect, useCallback } from 'react'

const MapView = dynamic(() => import('./components/MapView'), { ssr: false })

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

const INDICES = [
  { id: 'NDVI', label: 'NDVI', desc: 'Vegetación',    color: '#3ddc6e' },
  { id: 'NDWI', label: 'NDWI', desc: 'Agua',          color: '#4db8ff' },
  { id: 'EVI',  label: 'EVI',  desc: 'Veg. avanzada', color: '#86efac' },
  { id: 'NDRE', label: 'NDRE', desc: 'Red Edge',      color: '#a3e635' },
  { id: 'SAVI', label: 'SAVI', desc: 'Suelo ajust.',  color: '#fde68a' },
]

const ZONAS_NDVI = [
  { zona: 1,  rango: '0.90 – 1.00', color: '#005000' },
  { zona: 2,  rango: '0.80 – 0.89', color: '#007800' },
  { zona: 3,  rango: '0.70 – 0.79', color: '#22aa22' },
  { zona: 4,  rango: '0.60 – 0.69', color: '#64c832' },
  { zona: 5,  rango: '0.50 – 0.59', color: '#dcdc00' },
  { zona: 6,  rango: '0.40 – 0.49', color: '#ffb400' },
  { zona: 7,  rango: '0.30 – 0.39', color: '#ff7800' },
  { zona: 8,  rango: '0.20 – 0.29', color: '#dc3c00' },
  { zona: 9,  rango: '0.10 – 0.19', color: '#c81e1e' },
  { zona: 10, rango: '0.00 – 0.09', color: '#8c0000' },
]

type Estado = 'idle' | 'cargando_parcela' | 'parcela_ok' | 'buscando' | 'cargando_rgb' | 'calculando' | 'calculando_zonas' | 'done' | 'error'
type ModoVista = 'ninguna' | 'rgb' | 'indice' | 'zonas'

export default function Home() {
  const [estado, setEstado] = useState<Estado>('idle')
  const [error, setError] = useState('')
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [seleccionando, setSeleccionando] = useState(false)
  const [parcGeojson, setParcGeojson] = useState<any>(null)
  const [parcelaInfo, setParcelaInfo] = useState<any>(null)
  const [fechaInicio, setFechaInicio] = useState('2024-05-01')
  const [fechaFin, setFechaFin] = useState('2024-08-31')
  const [productos, setProductos] = useState<any[]>([])
  const [productoSel, setProductoSel] = useState('')
  const [indice, setIndice] = useState('NDVI')
  const [imagenUrl, setImagenUrl] = useState<string | null>(null)
  const [modoVista, setModoVista] = useState<ModoVista>('ninguna')
  const [stats, setStats] = useState<any>(null)
  const [zonasData, setZonasData] = useState<any[]>([])
  const [parcelaSupHa, setParcelaSupHa] = useState<number>(0)
  const [kgPorHa, setKgPorHa] = useState<Record<string, string>>({})
  const [produccion, setProduccion] = useState<any>(null)
  const [calculandoProd, setCalculandoProd] = useState(false)

  const indiceActual = INDICES.find(i => i.id === indice)!

  useEffect(() => {
    fetch(`${BACKEND}/health`).then(r => setBackendOk(r.ok)).catch(() => setBackendOk(false))
  }, [])

  const getBbox = (geojson: any): string => {
    const geom = geojson.features[0].geometry
    const allCoords: number[][] = []
    if (geom.type === 'Polygon') allCoords.push(...geom.coordinates[0])
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((p: any) => allCoords.push(...p[0]))
    const lons = allCoords.map(c => c[0])
    const lats = allCoords.map(c => c[1])
    const pad = 0.00005
    return `${Math.min(...lons)-pad},${Math.min(...lats)-pad},${Math.max(...lons)+pad},${Math.max(...lats)+pad}`
  }

  const getFecha = () => productos.find(p => p.id === productoSel)?.fecha || fechaInicio

  const resetear = () => {
    setImagenUrl(null); setStats(null); setModoVista('ninguna')
    setZonasData([]); setProduccion(null); setKgPorHa({})
  }

  const handleMapClick = useCallback(async (lat: number, lon: number) => {
    setSeleccionando(false)
    setEstado('cargando_parcela')
    setError('')
    setParcGeojson(null); setParcelaInfo(null); setProductos([])
    resetear()
    try {
      const r = await fetch(`${BACKEND}/sigpac/punto?lat=${lat}&lon=${lon}`)
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || `Error ${r.status}`) }
      const data = await r.json()
      setParcGeojson(data)
      const props = data.features?.[0]?.properties || {}
      setParcelaInfo(props)
      // Superficie SIGPAC viene en m², convertir a ha
      const supM2 = Number(props.superficie || 0)
      const supHa = supM2 > 1000 ? supM2 / 10000 : supM2
      setParcelaSupHa(supHa)
      setEstado('parcela_ok')
    } catch (e: any) {
      setEstado('error'); setError('No se encontró parcela: ' + e.message)
    }
  }, [])

  const buscarImagenes = async () => {
    if (!parcGeojson?.features?.length) return
    setEstado('buscando'); setError(''); setProductos([]); resetear()
    try {
      const bbox = getBbox(parcGeojson)
      const r = await fetch(`${BACKEND}/sentinel/buscar?bbox=${bbox}&fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}&max_nubosidad=30`)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const data = await r.json()
      if (!data.productos?.length) { setEstado('parcela_ok'); setError('No hay imágenes en ese periodo.'); return }
      setProductos(data.productos); setProductoSel(data.productos[0].id); setEstado('parcela_ok')
    } catch (e: any) { setEstado('error'); setError('Error buscando imágenes: ' + e.message) }
  }

  const verImagenRGB = async () => {
    if (!productoSel || !parcGeojson) return
    setEstado('cargando_rgb'); setError(''); setStats(null); setZonasData([]); setProduccion(null)
    try {
      const bbox = getBbox(parcGeojson)
      const gp = encodeURIComponent(JSON.stringify(parcGeojson))
      const r = await fetch(`${BACKEND}/imagen/rgb?bbox=${bbox}&fecha=${getFecha()}&geojson=${gp}`)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const blob = await r.blob()
      if (imagenUrl) URL.revokeObjectURL(imagenUrl)
      setImagenUrl(URL.createObjectURL(blob)); setModoVista('rgb'); setEstado('parcela_ok')
    } catch (e: any) { setEstado('error'); setError('Error cargando imagen: ' + e.message) }
  }

  const calcular = async () => {
    if (!productoSel || !parcGeojson) { setError('Primero busca imágenes'); return }
    if (indice === 'NDVI') { calcularZonasNDVI(); return }
    setEstado('calculando'); setError(''); setZonasData([]); setProduccion(null)
    try {
      const bbox = getBbox(parcGeojson)
      const gp = encodeURIComponent(JSON.stringify(parcGeojson))
      const base = `${BACKEND}/indice/calcular?bbox=${bbox}&fecha=${getFecha()}&indice=${indice}&geojson=${gp}`
      const [sr, ir] = await Promise.all([fetch(`${base}&formato=stats`), fetch(`${base}&formato=png`)])
      if (!sr.ok || !ir.ok) throw new Error('Error calculando índice')
      setStats(await sr.json())
      const blob = await ir.blob()
      if (imagenUrl) URL.revokeObjectURL(imagenUrl)
      setImagenUrl(URL.createObjectURL(blob)); setModoVista('indice'); setEstado('done')
    } catch (e: any) { setEstado('error'); setError('Error al calcular: ' + e.message) }
  }

  const calcularZonasNDVI = async () => {
    setEstado('calculando_zonas'); setError(''); setProduccion(null)
    try {
      const bbox = getBbox(parcGeojson)
      const gp = encodeURIComponent(JSON.stringify(parcGeojson))
      const r = await fetch(`${BACKEND}/ndvi/zonas?bbox=${bbox}&fecha=${getFecha()}&geojson=${gp}`)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const data = await r.json()
      setZonasData(data.zonas)
      const ir = await fetch(`${BACKEND}${data.imagen_url}`)
      const blob = await ir.blob()
      if (imagenUrl) URL.revokeObjectURL(imagenUrl)
      setImagenUrl(URL.createObjectURL(blob)); setModoVista('zonas'); setEstado('done')
    } catch (e: any) { setEstado('error'); setError('Error calculando zonas: ' + e.message) }
  }

  const calcularProduccion = async () => {
    if (!zonasData.length) return
    setCalculandoProd(true)
    try {
      const r = await fetch(`${BACKEND}/ndvi/produccion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zonas: zonasData, kg_por_ha: kgPorHa }),
      })
      if (!r.ok) throw new Error(`Error ${r.status}`)
      setProduccion(await r.json())
    } catch (e: any) { setError('Error calculando producción: ' + e.message) }
    finally { setCalculandoProd(false) }
  }

  const cargando = ['cargando_parcela', 'buscando', 'cargando_rgb', 'calculando', 'calculando_zonas'].includes(estado)

  const S = (style: any) => style // helper

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── SIDEBAR ── */}
      <aside style={{ width: 300, height: '100vh', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, borderRight: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>

        {/* Header */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 20 }}>🌱</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: 'var(--green)', letterSpacing: '0.05em' }}>SIGPAC · SENTINEL</span>
          </div>
          <p style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>Visor · Índices · Producción</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={backendOk ? 'pulse' : ''} style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: backendOk === null ? '#4a7a56' : backendOk ? 'var(--green)' : 'var(--red)' }}/>
          <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
            {backendOk === null ? 'CONECTANDO...' : backendOk ? 'BACKEND OK' : 'BACKEND OFFLINE'}
          </span>
        </div>

        <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />

        {/* PASO 1 */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>1</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>SELECCIONAR PARCELA</span>
          </div>
          <button onClick={() => setSeleccionando(s => !s)} style={{ width: '100%', padding: '10px', borderRadius: 8, background: seleccionando ? 'var(--green)' : 'var(--surface2)', border: `1px solid ${seleccionando ? 'var(--green)' : 'var(--border)'}`, color: seleccionando ? 'var(--bg)' : 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s' }}>
            {estado === 'cargando_parcela' ? <><span className="spinner"/> BUSCANDO...</> : seleccionando ? '✕ CANCELAR' : '⊕ CLIC EN EL MAPA'}
          </button>
          {seleccionando && <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(77,184,255,0.06)', border: '1px solid rgba(77,184,255,0.2)', fontSize: 11, color: 'var(--blue)', fontFamily: 'var(--mono)' }}>👆 Haz clic sobre una parcela en el mapa</div>}
          {parcelaInfo && (
            <div style={{ marginTop: 8, padding: '10px', borderRadius: 6, background: 'var(--green-dim)', border: '1px solid rgba(61,220,110,0.2)', fontSize: 11, fontFamily: 'var(--mono)' }}>
              <div style={{ color: 'var(--green)', fontWeight: 700, marginBottom: 6 }}>✓ PARCELA SELECCIONADA</div>
              <div style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
                {parcelaInfo.municipio && <div>Mun: <span style={{ color: 'var(--text)' }}>{parcelaInfo.municipio}</span></div>}
                {parcelaInfo.poligono && <div>Pol: <span style={{ color: 'var(--text)' }}>{parcelaInfo.poligono}</span></div>}
                {parcelaInfo.parcela && <div>Par: <span style={{ color: 'var(--text)' }}>{parcelaInfo.parcela}</span></div>}
                {parcelaInfo.uso_sigpac && <div>Uso: <span style={{ color: 'var(--text)' }}>{parcelaInfo.uso_sigpac}</span></div>}
                {parcelaInfo.superficie && (() => {
                  const sup = Number(parcelaInfo.superficie)
                  // SIGPAC devuelve superficie en m², hay que convertir a ha
                  const ha = sup > 1000 ? sup / 10000 : sup
                  return <div>Sup: <span style={{ color: 'var(--text)' }}>{ha.toFixed(4)} ha</span></div>
                })()}
              </div>
            </div>
          )}
        </section>

        {/* PASO 2 */}
        {parcGeojson && (
          <>
            <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>2</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>PERIODO</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                {[{ label: 'Desde', val: fechaInicio, set: setFechaInicio }, { label: 'Hasta', val: fechaFin, set: setFechaFin }].map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{f.label}</div>
                    <input type="date" value={f.val} onChange={e => f.set(e.target.value)} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 6px', color: 'var(--text)', fontSize: 11, fontFamily: 'var(--mono)', outline: 'none' }}/>
                  </div>
                ))}
              </div>
              <button onClick={buscarImagenes} disabled={cargando} style={{ width: '100%', padding: '8px', borderRadius: 6, background: 'transparent', border: '1px solid var(--blue)', color: 'var(--blue)', fontSize: 11, fontFamily: 'var(--mono)', cursor: cargando ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {estado === 'buscando' ? <><span className="spinner"/> BUSCANDO...</> : '◎ BUSCAR IMÁGENES'}
              </button>
              {productos.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Imagen ({productos.length} disponibles)</div>
                  <select value={productoSel} onChange={e => { setProductoSel(e.target.value); resetear() }} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 6px', color: 'var(--text)', fontSize: 10, fontFamily: 'var(--mono)', outline: 'none' }}>
                    {productos.map(p => <option key={p.id} value={p.id}>{p.fecha} · ☁ {p.nubosidad ?? '?'}% · {p.size_mb}MB</option>)}
                  </select>
                  <button onClick={verImagenRGB} disabled={cargando} style={{ width: '100%', marginTop: 8, padding: '9px', borderRadius: 6, background: modoVista === 'rgb' ? 'rgba(251,191,36,0.15)' : 'var(--surface2)', border: `1px solid ${modoVista === 'rgb' ? 'var(--amber)' : 'var(--border)'}`, color: modoVista === 'rgb' ? 'var(--amber)' : 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, cursor: cargando ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s' }}>
                    {estado === 'cargando_rgb' ? <><span className="spinner" style={{ borderTopColor: 'var(--amber)' }}/> CARGANDO...</> : modoVista === 'rgb' ? '🛰 IMAGEN CARGADA' : '🛰 VER IMAGEN REAL'}
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {/* PASO 3 */}
        {productos.length > 0 && (
          <>
            <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>3</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>ÍNDICE ESPECTRAL</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 10 }}>
                {INDICES.map(idx => (
                  <button key={idx.id} onClick={() => { setIndice(idx.id); setZonasData([]); setProduccion(null) }} style={{ padding: '7px 6px', borderRadius: 6, border: `1px solid ${indice === idx.id ? idx.color : 'var(--border)'}`, background: indice === idx.id ? idx.color : 'var(--surface2)', color: indice === idx.id ? 'var(--bg)' : 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer', transition: 'all 0.15s', fontWeight: indice === idx.id ? 700 : 400 }}>
                    <div style={{ fontWeight: 700 }}>{idx.label}</div>
                    <div style={{ fontSize: 9, opacity: 0.7, marginTop: 1 }}>{idx.desc}</div>
                  </button>
                ))}
              </div>
              <button onClick={calcular} disabled={cargando} style={{ width: '100%', padding: '11px', borderRadius: 8, background: cargando ? 'var(--surface2)' : indiceActual.color, border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, cursor: cargando ? 'wait' : 'pointer', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s' }}>
                {cargando ? <><span className="spinner" style={{ borderTopColor: 'var(--bg)' }}/> PROCESANDO...</> : indice === 'NDVI' ? '🌾 MAPA DE PRODUCCIÓN' : `▶ CALCULAR ${indice}`}
              </button>
              {indice === 'NDVI' && <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 4, textAlign: 'center' }}>Genera mapa de zonas por valor NDVI</div>}
            </section>
          </>
        )}

        {/* Stats índices normales */}
        {stats && modoVista === 'indice' && (
          <>
            <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
            <section>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em', marginBottom: 8 }}>ESTADÍSTICAS · {indice}</div>
              {stats.pixeles_parcela && <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 6 }}>Píxeles: <span style={{ color: 'var(--text)' }}>{stats.pixeles_parcela.toLocaleString()}</span></div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {[{ k: 'MÍN', v: stats.min?.toFixed(3) }, { k: 'MÁX', v: stats.max?.toFixed(3) }, { k: 'MEDIA', v: stats.mean?.toFixed(3) }, { k: 'DESV.', v: stats.std?.toFixed(3) }].map(s => (
                  <div key={s.k} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px' }}>
                    <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.k}</div>
                    <div style={{ fontSize: 15, fontFamily: 'var(--mono)', fontWeight: 700, color: indiceActual.color, marginTop: 2 }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* PASO 4: Mapa de producción NDVI */}
        {zonasData.length > 0 && (() => {
          // Superficie real de cada zona usando porcentaje * superficie total SIGPAC
          const totalPixeles = zonasData.reduce((acc: number, z: any) => acc + z.pixeles, 0)
          const zonasConSup = zonasData.filter((z: any) => z.pixeles > 0).map((z: any) => ({
            ...z,
            // Superficie real = porcentaje de pixeles * superficie total parcela SIGPAC
            sup_ha_real: totalPixeles > 0 ? (z.pixeles / totalPixeles) * parcelaSupHa : 0
          }))

          // Porcentajes por zona para regla de tres
          const ZONA_PCT: Record<number, number> = {1:100,2:90,3:80,4:70,5:60,6:50,7:40,8:30,9:15,10:5}

          // Calcular kg/ha automáticamente cuando el usuario introduce un valor
          const kgHaCalculado: Record<string, number> = {}
          const entradas = Object.entries(kgPorHa).filter(([_, v]) => v !== '' && Number(v) > 0)
          if (entradas.length > 0) {
            // Usar la primera zona con valor introducido como referencia
            const [zonaRef, kgRef] = entradas[0]
            const pctRef = ZONA_PCT[Number(zonaRef)] || 100
            const kgZona1 = Number(kgRef) / (pctRef / 100)
            Object.entries(ZONA_PCT).forEach(([z, pct]) => {
              kgHaCalculado[z] = Math.round(kgZona1 * (pct / 100))
            })
          }

          return (
          <>
            <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>4</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>MAPA DE PRODUCCIÓN</span>
              </div>

              {/* Leyenda con superficie real */}
              <div style={{ marginBottom: 12 }}>
                {zonasConSup.map((z: any) => {
                  const totalHaZonas = zonasConSup.reduce((acc: number, zz: any) => acc + zz.sup_ha_real, 0)
                  const zi = ZONAS_NDVI.find(zn => zn.zona === z.zona)!
                  const pct = totalHaZonas > 0 ? ((z.sup_ha_real / totalHaZonas) * 100).toFixed(1) : '0'
                  return (
                    <div key={z.zona} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: zi.color, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}/>
                        <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', flex: 1 }}>
                          Z{z.zona} <span style={{ opacity: 0.6 }}>({zi.rango})</span>
                        </div>
                        <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text)', fontWeight: 600 }}>
                          {z.sup_ha_real.toFixed(4)} ha
                        </div>
                        <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: zi.color, width: 32, textAlign: 'right' }}>
                          {pct}%
                        </div>
                      </div>
                      <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: zi.color, borderRadius: 2, transition: 'width 0.3s' }}/>
                      </div>
                    </div>
                  )
                })}
                <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 6, textAlign: 'right' }}>
                  Total parcela: <span style={{ color: 'var(--green)', fontWeight: 700 }}>{parcelaSupHa.toFixed(4)} ha</span>
                </div>
              </div>

              {/* Input kg/ha con regla de tres automática */}
              <div style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)', marginBottom: 4, letterSpacing: '0.06em', fontWeight: 700 }}>
                KG/HA ESPERADOS POR ZONA:
              </div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
                Introduce un valor y el resto se calcula automáticamente
              </div>

              {zonasConSup.map((z: any) => {
                const zi = ZONAS_NDVI.find(zn => zn.zona === z.zona)!
                const calculado = kgHaCalculado[String(z.zona)]
                const tieneInput = kgPorHa[String(z.zona)] !== undefined && kgPorHa[String(z.zona)] !== ''
                const valorMostrar = tieneInput ? kgPorHa[String(z.zona)] : (calculado !== undefined ? String(calculado) : '')
                return (
                  <div key={z.zona} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: zi.color, flexShrink: 0 }}/>
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', width: 38, flexShrink: 0 }}>Z{z.zona}</div>
                    <input
                      type="number"
                      min="0"
                      placeholder="kg/ha"
                      value={kgPorHa[String(z.zona)] || ''}
                      onChange={e => {
                        const val = e.target.value
                        // Al cambiar un valor, limpiar los demás para recalcular
                        setKgPorHa({ [String(z.zona)]: val })
                      }}
                      style={{
                        flex: 1, background: tieneInput ? 'rgba(61,220,110,0.08)' : 'var(--surface2)',
                        border: `1px solid ${tieneInput ? 'var(--green)' : 'var(--border)'}`,
                        borderRadius: 5, padding: '5px 6px', color: 'var(--text)', fontSize: 11,
                        fontFamily: 'var(--mono)', outline: 'none',
                      }}
                    />
                    {calculado !== undefined && !tieneInput && (
                      <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', width: 40, textAlign: 'right' }}>
                        ={calculado}
                      </div>
                    )}
                    {tieneInput && (
                      <div style={{ fontSize: 9, color: 'var(--green)', fontFamily: 'var(--mono)', width: 40, textAlign: 'right' }}>
                        ref
                      </div>
                    )}
                  </div>
                )
              })}

              <button
                onClick={() => {
                  // Calcular producción con kgHaCalculado
                  const zonasCalc = zonasConSup.map((z: any) => ({
                    ...z,
                    superficie_ha: z.sup_ha_real,
                    color_hex: ZONAS_NDVI.find(zn => zn.zona === z.zona)?.color || '#888',
                  }))
                  const kgFinal: Record<string, string> = {}
                  Object.entries(ZONA_PCT).forEach(([z, _]) => {
                    if (kgHaCalculado[z] !== undefined) kgFinal[z] = String(kgHaCalculado[z])
                  })
                  // Llamar directamente con los datos calculados
                  fetch(`${BACKEND}/ndvi/produccion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ zonas: zonasCalc, kg_por_ha: kgFinal }),
                  }).then(r => r.json()).then(data => setProduccion(data))
                    .catch(e => setError('Error: ' + e.message))
                }}
                disabled={Object.keys(kgPorHa).length === 0}
                style={{
                  width: '100%', marginTop: 8, padding: '10px', borderRadius: 8,
                  background: Object.keys(kgPorHa).length > 0 ? 'var(--green)' : 'var(--surface2)',
                  border: 'none', color: 'var(--bg)',
                  fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12,
                  cursor: Object.keys(kgPorHa).length > 0 ? 'pointer' : 'not-allowed',
                  letterSpacing: '0.06em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                🌾 CALCULAR PRODUCCIÓN
              </button>
            </section>
          </>
          )
        })()}


        {/* Resultado producción */}
        {produccion && (
          <>
            <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
            <section>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em', marginBottom: 10 }}>ESTIMACIÓN DE COSECHA</div>

              {produccion.zonas.filter((z: any) => z.kg_por_ha > 0).map((z: any) => (
                <div key={z.zona} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 10, fontFamily: 'var(--mono)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: 2, background: z.color_hex }}/>
                    <span style={{ color: 'var(--muted)' }}>Z{z.zona}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 9, opacity: 0.6 }}>{z.superficie_ha.toFixed(4)}ha · {Math.round(z.kg_por_ha)}kg/ha</span>
                  </div>
                  <span style={{ color: 'var(--text)', fontWeight: 700 }}>{Math.round(z.kg_estimados).toLocaleString()} kg</span>
                </div>
              ))}

              <div style={{ marginTop: 10, padding: '12px', borderRadius: 8, background: 'var(--green-dim)', border: '1px solid rgba(61,220,110,0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11, fontFamily: 'var(--mono)' }}>
                  <span style={{ color: 'var(--muted)' }}>Superficie analizada</span>
                  <span style={{ color: 'var(--text)' }}>{produccion.total_ha.toFixed(4)} ha</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11, fontFamily: 'var(--mono)' }}>
                  <span style={{ color: 'var(--muted)' }}>Total kilogramos</span>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>{Math.round(produccion.total_kg).toLocaleString()} kg</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--mono)', marginBottom: 5 }}>
                  <span style={{ color: 'var(--muted)' }}>Rendimiento medio</span>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                    {produccion.total_ha > 0 ? Math.round(produccion.total_kg / produccion.total_ha).toLocaleString() : 0} kg/ha
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontFamily: 'var(--mono)', fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(61,220,110,0.2)' }}>
                  <span style={{ color: 'var(--muted)' }}>TOTAL TONELADAS</span>
                  <span style={{ color: 'var(--green)', fontSize: 18 }}>{produccion.total_toneladas.toFixed(3)} t</span>
                </div>
              </div>
            </section>
          </>
        )}

        {error && <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)', color: '#fca5a5', fontSize: 11, fontFamily: 'var(--mono)' }}>⚠ {error}</div>}

        <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', lineHeight: 1.7 }}>
          SIGPAC WMS · Copernicus DS<br />Zonas NDVI · Estimación cosecha<br />100% FREE & OPEN DATA
        </div>
      </aside>

      {/* MAPA */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapView onParcelaClick={handleMapClick} parcGeojson={parcGeojson} imagenUrl={imagenUrl} indiceColor={modoVista === 'rgb' ? '#fbbf24' : modoVista === 'zonas' ? '#3ddc6e' : indiceActual.color} seleccionando={seleccionando}/>

        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, fontFamily: 'var(--mono)', fontSize: 11, background: 'rgba(15,26,18,0.92)', border: '1px solid var(--border)', backdropFilter: 'blur(8px)', borderRadius: 6, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          {modoVista === 'ninguna' && <span style={{ color: 'var(--muted)' }}>SIN OVERLAY</span>}
          {modoVista === 'rgb' && <span style={{ color: 'var(--amber)' }}>🛰 COLOR NATURAL</span>}
          {modoVista === 'indice' && <><span style={{ color: 'var(--muted)' }}>ÍNDICE</span><span style={{ color: indiceActual.color, fontWeight: 700 }}>{indice}</span><span style={{ color: 'var(--green)' }}>✓</span></>}
          {modoVista === 'zonas' && <span style={{ color: 'var(--green)', fontWeight: 700 }}>🌾 ZONAS NDVI</span>}
        </div>

        {estado === 'idle' && !seleccionando && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none', zIndex: 500 }}>
            <div style={{ fontSize: 56, marginBottom: 14, opacity: 0.2 }}>🌾</div>
            <p style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: '0.08em', lineHeight: 1.8 }}>PULSA "CLIC EN EL MAPA"<br />Y SELECCIONA UNA PARCELA</p>
          </div>
        )}

        {seleccionando && (
          <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, pointerEvents: 'none', background: 'rgba(77,184,255,0.1)', border: '1px solid var(--blue)', backdropFilter: 'blur(8px)', borderRadius: 8, padding: '10px 20px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--blue)', letterSpacing: '0.06em' }}>
            👆 HAZ CLIC SOBRE UNA PARCELA EN EL MAPA
          </div>
        )}
      </div>
    </div>
  )
}
