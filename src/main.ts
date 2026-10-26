import './style.css'
import * as THREE from 'three'

type Lang = 'ja' | 'en'
type Unit = 'cm' | 'in'

const T = {
  ja: {
    app: 'ARメジャー', big: '大きい文字', lead: 'スマホのカメラで、物の長さを測ります。',
    s1: '「測りはじめる」を押して、カメラを許可します。',
    s2: 'スマホをゆっくり動かして、床や机を映します。白い輪が出るまで待ちます。',
    s3: '輪を測りたい端に合わせて、画面をタップ（または「点を置く」）。これが A 点です。',
    s4: 'もう一方の端に輪を合わせて、もう一度タップ。A から B までの長さが出ます。続けて何本でも測れます。',
    unit: '単位：', start: '測りはじめる',
    note: 'Android の Chrome で動きます。長さはだいたいの目安です（数％ずれることがあります）。一度開けば電波がなくても使えます。',
    undo: '1つ戻す', clear: '全部消す', add: '点を置く', exit: '終わる',
    hScan: 'スマホをゆっくり動かして、床や机を映してください…', hA: '輪を始めの端に合わせて、タップ', hB: '輪を終わりの端に合わせて、タップ',
    total: '合計', checking: '確認しています…',
    noXr: 'この端末やブラウザでは AR が使えないようです。\n\nAndroid のスマホで Chrome を使い、「Google Play 開発者サービス（AR）」が入っていると使えます。iPhone の Safari は、いまは対応していません。',
    insecure: 'このページは https で開いてください。',
    fail: 'AR を始められませんでした。カメラの使用を許可して、もう一度ためしてください。',
  },
  en: {
    app: 'AR Tape Measure', big: 'Large text', lead: 'Measure real things with your phone camera.',
    s1: 'Press “Start measuring” and allow the camera.',
    s2: 'Move your phone slowly over the floor or a table. Wait until a white ring appears.',
    s3: 'Put the ring on one end of the thing and tap the screen (or “Add point”). That is point A.',
    s4: 'Put the ring on the other end and tap again. You will see the length from A to B. You can measure as many lines as you like.',
    unit: 'Units:', start: 'Start measuring',
    note: 'Works in Chrome on Android. Lengths are a close guide (they can be a few percent off). After the first visit it works with no signal.',
    undo: 'Undo', clear: 'Clear all', add: 'Add point', exit: 'Done',
    hScan: 'Move your phone slowly over the floor or a table…', hA: 'Put the ring on the start and tap', hB: 'Put the ring on the end and tap',
    total: 'Total', checking: 'Checking…',
    noXr: 'AR doesn’t seem to work on this device or browser.\n\nIt works in Chrome on an Android phone that has “Google Play Services for AR”. Safari on iPhone does not support it yet.',
    insecure: 'Please open this page over https.',
    fail: 'Could not start AR. Please allow the camera and try again.',
  },
}

let lang: Lang = (localStorage.getItem('arm-lang') as Lang) || 'ja'
let unit: Unit = (localStorage.getItem('arm-unit') as Unit) || 'cm'
const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E

function t(k: keyof typeof T.ja) { return T[lang][k] }
function applyLang() {
  document.documentElement.lang = lang
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t as keyof typeof T.ja) })
  $('lang').textContent = lang === 'ja' ? 'English' : '日本語'
  $('lang').lang = lang === 'ja' ? 'en' : 'ja'
  document.title = lang === 'ja' ? 'ARメジャー' : 'AR Tape Measure'
}
function applyUnit() {
  document.querySelectorAll<HTMLElement>('.unit').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.u === unit)))
  $('units').textContent = unit === 'cm' ? 'cm' : 'inch'
  localStorage.setItem('arm-unit', unit)
}
export function fmt(m: number, u: Unit = unit): string {
  if (u === 'cm') return m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`
  const inch = m / 0.0254
  if (inch < 36) return `${inch.toFixed(1)} in`
  const ft = Math.floor(inch / 12)
  return `${ft} ft ${(inch - ft * 12).toFixed(1)} in`
}

const big = $('big')
if (localStorage.getItem('arm-big') === '1') { document.documentElement.classList.add('big'); big.setAttribute('aria-pressed', 'true') }
big.onclick = () => {
  const on = document.documentElement.classList.toggle('big')
  big.setAttribute('aria-pressed', String(on)); localStorage.setItem('arm-big', on ? '1' : '0')
}
$('lang').onclick = () => { lang = lang === 'ja' ? 'en' : 'ja'; localStorage.setItem('arm-lang', lang); applyLang(); refreshLabels() }
document.querySelectorAll<HTMLElement>('.unit').forEach((b) => (b.onclick = () => { unit = b.dataset.u as Unit; applyUnit() }))
$('units').onclick = () => { unit = unit === 'cm' ? 'in' : 'cm'; applyUnit(); refreshLabels() }
applyLang(); applyUnit()

function showMsg(s: string) { const m = $('msg'); m.textContent = s; m.hidden = false }

// ---------- AR ----------
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, reticle: THREE.Mesh
let session: XRSession | null = null
let hitSource: XRHitTestSource | null = null
const points: THREE.Vector3[] = []
const marks: THREE.Object3D[] = []
const lines: THREE.Line[] = []
let lineGroup: THREE.Group
let preview: THREE.Line
const labelEls: HTMLDivElement[] = []

function setupThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.xr.enabled = true
  renderer.domElement.style.display = 'none'
  document.body.appendChild(renderer.domElement)
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3))
  const ring = new THREE.RingGeometry(0.03, 0.04, 32).rotateX(-Math.PI / 2)
  reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff }))
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.004, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe4b15c }))
  reticle.add(dot)
  reticle.matrixAutoUpdate = false; reticle.visible = false
  scene.add(reticle)
  lineGroup = new THREE.Group(); scene.add(lineGroup)
  preview = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.01, gapSize: 0.01 }))
  preview.visible = false; scene.add(preview)
}

function hint() {
  const h = $('hint')
  if (!reticle?.visible) h.textContent = t('hScan')
  else h.textContent = points.length % 2 === 0 ? t('hA') : t('hB')
}

function addPoint() {
  if (!reticle.visible) return
  const p = new THREE.Vector3().setFromMatrixPosition(reticle.matrix)
  points.push(p)
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe4b15c }))
  m.position.copy(p); scene.add(m); marks.push(m)
  if (points.length % 2 === 0) {
    const a = points[points.length - 2]
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, p]), new THREE.LineBasicMaterial({ color: 0xffffff }))
    lineGroup.add(l); lines.push(l)
    const el = document.createElement('div'); el.className = 'lbl'; $('labels').appendChild(el); labelEls.push(el)
  }
  refreshLabels(); navigator.vibrate?.(15)
}
function undo() {
  if (!points.length) return
  if (points.length % 2 === 0) { const l = lines.pop()!; lineGroup.remove(l); labelEls.pop()!.remove() }
  points.pop(); const m = marks.pop()!; scene.remove(m); refreshLabels()
}
function clearAll() { while (points.length) undo() }

function refreshLabels() {
  let sum = 0
  for (let i = 0; i < labelEls.length; i++) {
    const d = points[i * 2].distanceTo(points[i * 2 + 1]); sum += d
    labelEls[i].textContent = fmt(d)
  }
  $('total').textContent = labelEls.length > 1 ? `${t('total')} ${fmt(sum)}` : ''
}

function placeLabels(cam: THREE.Camera) {
  const w = window.innerWidth, h = window.innerHeight, v = new THREE.Vector3()
  labelEls.forEach((el, i) => {
    v.copy(points[i * 2]).add(points[i * 2 + 1]).multiplyScalar(0.5).project(cam)
    const behind = v.z > 1
    el.style.display = behind ? 'none' : ''
    el.style.left = `${((v.x + 1) / 2) * w}px`; el.style.top = `${((1 - v.y) / 2) * h}px`
  })
}

async function start() {
  if (!window.isSecureContext) return showMsg(t('insecure'))
  const ok = await navigator.xr?.isSessionSupported('immersive-ar').catch(() => false)
  if (!ok) return showMsg(t('noXr'))
  if (!renderer) setupThree()
  const overlay = $('overlay')
  try {
    session = await navigator.xr!.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay },
    } as XRSessionInit)
  } catch { return showMsg(t('fail')) }
  overlay.hidden = false
  $('msg').hidden = true
  renderer!.xr.setReferenceSpaceType('local')
  await renderer!.xr.setSession(session)
  const viewer = await session.requestReferenceSpace('viewer')
  hitSource = (await session.requestHitTestSource!({ space: viewer })) ?? null
  session.addEventListener('select', addPoint)
  session.addEventListener('end', () => { overlay.hidden = true; hitSource = null; session = null; renderer!.setAnimationLoop(null) })
  hint()
  renderer!.setAnimationLoop((_t, frame?: XRFrame) => {
    if (!frame) return
    const ref = renderer!.xr.getReferenceSpace()!
    const hits = hitSource ? frame.getHitTestResults(hitSource) : []
    const was = reticle.visible
    if (hits.length) {
      const pose = hits[0].getPose(ref)
      if (pose) { reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix) }
    } else reticle.visible = false
    if (was !== reticle.visible) hint()
    if (points.length % 2 === 1 && reticle.visible) {
      const a = points[points.length - 1], b = new THREE.Vector3().setFromMatrixPosition(reticle.matrix)
      preview.geometry.setFromPoints([a, b]); preview.computeLineDistances(); preview.visible = true
      $('hint').textContent = `${t('hB')} — ${fmt(a.distanceTo(b))}`
    } else preview.visible = false
    const xrCam = renderer!.xr.getCamera()
    renderer!.render(scene, camera)
    placeLabels(xrCam)
  })
}

// Taps on buttons must not also drop a point.
document.querySelectorAll('.bar button').forEach((b) => b.addEventListener('beforexrselect', (e) => e.preventDefault()))
$('start').onclick = start
$('add').onclick = () => { addPoint(); hint() }
$('undo').onclick = () => { undo(); hint() }
$('clear').onclick = () => { clearAll(); hint() }
$('exit').onclick = () => session?.end()

// Friendly early check
if (!('xr' in navigator)) showMsg(T[lang].noXr)
