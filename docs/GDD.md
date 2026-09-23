# Dra. Emiliana: Kinky-Kawaii Ortho-Gore — GDD (referencia de implementación, versión web)

Documento original y vivo: https://claude.ai/code/artifact/d02dbb06-d977-45f6-8782-830ee3b60209
Este archivo es la copia de trabajo para programar. Cuando haya conflicto con `src/core/contracts.ts`, mandan los contratos.

## 0. Adaptación a la web (decisiones de esta versión)

- Motor: navegador, TypeScript + Three.js (WebGL) + Canvas 2D + WebAudio. Sin assets externos: toda la geometría, texturas y sonidos son procedurales.
- Estilo visual: 3D estilizado "juguete de vinilo" (formas redondeadas, materiales con clearcoat/brillo tipo vinilo, iluminación suave), paleta kawaii (lila #c8a2e8, menta #9ff0d0, rosa chicle #ff8fc7, fucsia #ff2e93). La herida es un lienzo 2D detallado (capas de tejido, sangre, hueso) proyectado sobre un plano 3D en la ventana de los paños quirúrgicos.
- El paciente está cubierto con paños quirúrgicos lila; solo se ve la cabeza (con tubo endotraqueal) y la ventana rectangular de la herida. Esto evita alinear la herida con cada anatomía.
- Controles: ratón + teclado (el mando es opcional y no es prioridad).
- Idioma: toda la interfaz y el diálogo en español (latinoamericano neutro).
- Gore: realista pero regulable (deslizador 0–100) y Modo Pastel (sangre = jarabe de fresa rosa brillante, con destellos).

## 1. Visión y pilares

La fantasía: ser la cirujana más competente de una clínica veterinaria absurda, con las manos en una herida realista y un equipo que lo complica todo. El chiste nunca es el animal; el chiste es el equipo humano.

| Pilar | Qué significa | Prueba |
| --- | --- | --- |
| Las manos importan | Cada instrumento es un gesto con peso, resistencia y sonido. | Si algo se resuelve con un clic sin apuntar, se rediseña. |
| El caos es el equipo | La presión viene de personas con nombre. | Cada evento de presión tiene un responsable visible. |
| Mandar cuesta | La autoridad de Emiliana es un recurso emocional finito. | El jugador siente la tentación de gritar y paga por hacerlo. |
| Aprender sin darse cuenta | La medicina es real aunque la estética sea absurda. | Cada caso deja 2–3 datos veterinarios correctos. |

### Límites de contenido (obligatorios)
- Lo kinky es moda, carácter y comedia: vestuario, accesorios y la fusta como puntero de mando. Sin desnudos ni escenas sexuales.
- "Buena niña"/"Buena chica" solo llega de su pareja (fuera de pantalla, solo texto) como afirmación cariñosa. Nunca términos degradantes. Si otro personaje lo intenta, no funciona (gag).
- Todos los humanos son adultos (internos ~24–26 años).
- Ningún paciente muere. Peor final: Valerio toma el control, el animal sobrevive, nota F.
- Aviso de contenido al inicio y en cada caso.

## 2. Personajes como sistemas

### Emiliana (jugadora)
Plus-size realista (pancita suave, caderas anchas, mejillas llenas), sonrisa dulce. Corsé de vinilo fucsia con anillas en D doradas, arnés shibari lavanda que sostiene el estetoscopio, gargantilla de cuero con candado de corazón y llavecita, esposas de felpa rosa en el cinto, medias de rejilla, botas militares de plataforma, fusta rosada.

Medidores:
- Concentración 0–100: estabilidad de manos. < 40 → temblor en la punta y viñeta. Baja con sangre en el campo, comentarios de Valerio, fallos del equipo, poca luz.
- Reserva Emocional 0–100: solo baja cuando elige mandar con dureza.

Formas de mandar (teclas Z Rodrigo, X Fritz, C Gigi):
| Forma | Entrada | Respuesta | Coste |
| --- | --- | --- | --- |
| Petición amable | tocar la tecla | 1,5–3 s; a veces "¿ahora?" | gratis |
| Orden de Dómina (chasquido de fusta) | mantener ≥ 0,4 s | 0,3 s y ejecución perfecta 8 s | −15 Reserva (−12 con fusta de pompón) |
| Voz Firme y Dulce (desde semana 4) | doble toque | 0,8 s | −5 Reserva |

- Micro-crisis: Reserva a 0 → voz quebrada, pide perdón a Fritz, 3 s sin poder mandar, −15 Concentración. Nunca game over.
- Mensajes de la pareja ("Buena niña"): el reloj vibra 1–3 veces por cirugía tras hitos (fase sin errores, hemorragia arterial controlada). Leer (tecla F) = soltar el instrumento 2 s (la herida sigue sangrando). Recompensa: +35 Reserva, +25 Concentración, rubor, corazones y 10 s de Pulso Sereno (temblor 0). Caduca a los 20 s (30 con gargantilla) → se guarda para la pausa entre fases con la mitad de efecto.
- El jugador elige nombre y pronombres de la pareja (ella/él/elle). Nunca aparece.
- Respiración cuadrada (tecla B): mini-juego de 16 s (inspira 4, retén 4, exhala 4, retén 4) → +20 Concentración; solo con Éxito estable (≥ 50 y campo < 50%).
- Pulso Firme (Shift mantenido): mano al 40% de velocidad y sin temblor; −5 Concentración/s.

Arco: de creer que solo la obedecen si hace de Dominatrix a una autoridad propia, firme y dulce.

### El equipo
| Personaje | Mecánica | Contrarresto | Reacción al tono |
| --- | --- | --- | --- |
| Dr. Valerio Sterling (auditor, 1,88 m, canas peinadas atrás, gafas metálicas, bata impecable) | Mirada de Auditor: mientras mira, los errores cuentan doble. Reto de Valerio al inicio. | Hacer lo difícil cuando mira; cumplir el reto = +3. | Inmune; solo le convence la técnica. |
| Rodrigo (fornido, barriga cervecera, coronilla calva con rastas largas, camiseta de rock, scrub verde abierto, auriculares) | Aspira al ritmo de su música. Solo de Guitarra: aparta la cánula 4–6 s como un bajo. | Orden, o empujar la manguera (clic derecho + arrastrar sobre la herida). | Responde a ambos; con Voz Firme o "¡Eso es rock!" gana +25% caudal 10 s. |
| Fritz (joven pálido, delgado, mascarilla en el mentón, manos temblorosas) | Su temblor hace rebotar tornillos y placas. | Atraparlos en su ventana de tiempo. | La Orden de Dómina le sube el temblor +50% 10 s; la amabilidad lo calma. |
| Gigi (coleta alta rubia, maquillaje perfecto, móvil siempre) | Selfie Cialítica: gira la lámpara hacia su cara, la herida cae al 15% de luz. | Orden, o reorientar la lámpara tú (mantener L 1,5 s). | Ignora peticiones amables si está grabando. |

Gigi: si la dejas grabar justo tras un gesto Perfecto, clip viral (+Reputación). Si graba en mal momento, operas a oscuras.

### Dueños y fauna (clínica)
| Personaje | Mecánica | Solución |
| --- | --- | --- |
| Doña Hortensia (madre histérica del caniche Merengue) | Medidor de Histeria: si ve sangre u oye la sierra, grita/se desmaya y arrastra a un asistente. | Cerrar puertas, darle tila, diagnóstico tranquilizador. |
| Don Braulio (conspiranoico con gorro de aluminio) | Envuelve aparatos en aluminio "contra el 5G"; el monitor pierde señal. | Quitar el aluminio y convencerlo con un diagnóstico educativo. |
| Panchito (chihuahua de Braulio, hiperactivo, con cono) | Corre en círculos y entra en zonas estériles; en dificultad alta se cuela en el quirófano. | Placaje (Espacio cerca) y devolverlo al transportín. |

## 3. Bucle dual

Clínica (4–6 min) → Triage y diagnóstico → Preparación → Quirófano (6 fases) → Auditoría de Valerio (S–F) → Boutique → siguiente semana.

### Fase 1: Clínica (tercera persona, WASD, E interactuar, Espacio placaje)
1. Triage: 2–4 dueños con medidor de Paciencia. Uno trae el caso de la semana; los demás, casos menores rápidos (uñas, vacunas, otitis) que dan HuesoCoins (mini-acción de 3–5 s cada uno).
2. Exploración física con gestos reales: prueba del cajón craneal (cruzado), palpación de rótula (luxación patelar), pinzamiento de dedos (dolor profundo, hernias), crepitación, palpación de cadera, estrés del carpo. Radiografía en el negatoscopio: marcar la lesión con la fusta (clic).
3. Diagnóstico al dueño: elegir diagnóstico (3 opciones) y explicación: absurda-educativa (calma + puntos de Educación), técnica (dispara la Histeria de Hortensia), evasiva (calma ahora, queja después).
4. Contención de fauna: quirófano, sala de preparación y autoclave tienen medidor de Contaminación; Panchito lo sube.
5. Coordinación: asignar Fritz→autoclave (juegos esterilizados), Rodrigo→rasurado/antisepsia (calidad de preparación), Gigi→consentimiento (si no, graba y baja su utilidad).

Efectos en el quirófano:
| Resultado en la clínica | Efecto |
| --- | --- |
| Diagnóstico correcto y radiografía marcada | Guías de corte visibles (según nivel) y +10 Éxito inicial |
| Diagnóstico erróneo | Sin guías y −10 Éxito inicial |
| Juegos esterilizados | Repuestos si algo cae; sin repuestos, 20 s de espera |
| Calidad de rasurado/antisepsia | Nota de Esterilidad |
| Zonas contaminadas | Más intrusiones de Panchito |
| Dueño calmado / histérico | Propina / llamadas al móvil de Gigi (más selfies) |
| Concentración y Reserva al salir | Valores iniciales en quirófano |
| Trato al equipo | Moral: frecuencia de fallos |

## 4. Cirugía

Mano derecha = instrumento activo (ratón). Clic derecho = mano izquierda (empujar manguera de Rodrigo). Rueda = presión (1–5). Teclas 1–6 = instrumental. Shift = Pulso Firme. Z/X/C = mandar. F = leer reloj. B = respirar. L = lámpara a mano. Q/E = girar. Espacio = acción contextual (atrapar tornillo, compresión RCP). Esc = pausa. Tab = alternar cámara general/herida.

### Gesto de cada instrumento
| Instrumento | Gesto | Medida | Error |
| --- | --- | --- | --- |
| Bisturí #10/#15 | Trazo continuo con presión constante sobre la guía | Desviación (mm), profundidad por capa, velocidad | Zigzag = peor técnica; demasiado hondo = vaso cortado |
| Electrocauterio bipolar | Mantener sobre el vaso 1–2 s | Tiempo de contacto | > 3 s carbonización + humo; < 0,5 s no sella |
| Aspiración (Rodrigo) | Seguir el charco | %BV/s retirado | — |
| Separadores Gelpi/Weitlaner | Puntas en los bordes, abrir por clics de trinquete | Exposición vs presión | Abrir de más: sufrimiento muscular |
| Pinzas Kern | Agarrar fragmento, arrastrar y girar (Q/E) hasta la silueta fantasma | Error angular (°) y desplazamiento (mm) | Forzar (arrastrar muy rápido contra otro fragmento) = fisura iatrogénica |
| Taladro | Mantener clic dosificando | Temperatura (umbral 47 °C), salida por la segunda cortical | > 47 °C sostenido: necrosis térmica; avanzar de más: "plunge" |
| Sierra oscilante/birradial | Pasadas cortas con irrigación (I o clic derecho) | Temperatura y trayectoria | Sin irrigar: calor; desviarse: mala rotación |
| Placa bloqueada | Elegir tamaño, contornear con dobladoras (2–3 gestos) y posicionar | Contacto y alineación | Mal contorneada: tornillos no bloquean |
| Tornillos de titanio | Atrapar de la bandeja de Fritz, medir, atornillar hasta el clic | Longitud y torque | Pasarse = rosca rota; caído = contaminado |
| Porta-agujas | Semicírculos que cruzan la incisión; nudo | Espaciado y tensión | Tensión excesiva = isquemia de bordes |
| Vendaje | Círculos con tensión pareja | Uniformidad | Apretado = dedos hinchados |

### Las 6 fases (genéricas; cada caso las adapta)
1. Incisión (0–15%): piel, subcutáneo, fascia; cada capa con su resistencia.
2. Hemostasia (15–30%): 3–6 sangrados (capilar rezuma, venoso oscuro constante, arterial pulsátil sincronizado con la FC). Cauterizar por gravedad; separadores. Fase favorita del Solo de Guitarra.
3. Reducción ósea (30–50%): pinzas Kern, silueta fantasma menta, crujidos. Arco en C (R) da radiografía instantánea: cada disparo suma dosis y Gigi debe salir. Aguja de Kirschner temporal.
4. Osteosíntesis con placa (50–70%): tamaño correcto, contornear, apoyar. Fritz la trae temblando.
5. Fijación de pernos (70–85%): anillo que se cierra sobre el tornillo de Fritz (Perfecto/Bien/Fallo). Fallo = cae, "¡CONTAMINADO!". Taladro piloto (calor), medir profundidad, atornillar hasta el clic. La ventana sigue el tempo de la música; atrapar a tempo = bonus.
6. Sutura y vendaje (85–100%): por capas y vendaje. Aquí conviene dejar grabar a Gigi. El paciente despierta con animación tierna.

### Director de Caos
Reparte interferencias según rendimiento. Residente: nunca dos a la vez. Especialista: hasta dos desde la semana 5. Jefe: dos. Tras cada evento fuerte, valle de 15–20 s. Ajuste adaptativo ±30% según el Éxito mínimo de las últimas 3 cirugías (desactivable).

## 5. Reglas y puntuación

### Progreso %
Pesos por fase definidos en los datos del caso (suman 100). Cada fase tiene checklist de 1–3 pasos.

### Éxito % (estabilidad)
Modelo fisiológico simplificado: volumen de sangre, FC, SpO₂, PAM, EtCO₂, temperatura. Empieza en 60% + bonus de clínica.
- Pérdida > 15% del volumen: taquicardia compensatoria.
- > 30%: hipotensión (PAM < 60 mmHg), el Éxito cae rápido.
- Pacientes pequeños (conejo, chihuahua): la temperatura baja con el tiempo; manta de aire caliente (pedir a Gigi).
- Volumen sanguíneo estimado: perro ~85 mL/kg, gato ~60 mL/kg, conejo ~60 mL/kg.

| Evento | Éxito |
| --- | --- |
| Gesto Perfecto | +1 a +3 |
| Hemorragia arterial controlada en < 5 s | +4 |
| Cada segundo con constantes fuera de rango | −0,5 a −2 según gravedad |
| Vaso cortado | −5 y nuevo sangrado |
| Hueso > 47 °C sostenido | −8 y marca de necrosis |
| Taladro que atraviesa de más (plunge) | −10 |
| Tornillo contaminado implantado | −10 |
| Fisura iatrogénica | −12 |

### Paro y reanimación (guías veterinarias RECOVER)
Si el Éxito llega a 0 → paro. RCP: compresiones 100–120/min (Espacio al ritmo del riff de Rodrigo), ventilación 10/min (Fritz con ambu, una cada 6 s), ritmo en monitor; si FV → cargar desfibrilador (mantener D), "¡Despejen!" (esperar a que Gigi se aparte), descarga (soltar D). Adrenalina cada 3–5 min de tiempo clínico. Éxito → circulación espontánea, Éxito al 25% y rango máximo B. Una reanimación por cirugía (dos en Residente); si falla, Valerio toma el control, paciente vivo, nota F.

### Auditoría de Valerio
Nota = 0,30·T + 0,25·E + 0,15·H + 0,10·S + 0,10·L + 0,10·t (todos 0–100).
- T: técnica media de los gestos. E: 60% media del Éxito + 40% su mínimo. H: hemostasia (sangre perdida frente a la tolerable, 30%BV). S: esterilidad. L: liderazgo. t: tiempo frente al objetivo.
- Liderazgo penaliza: asistente fallando > 5 s sin corregir, Órdenes de Dómina > 60% de las órdenes, cada micro-crisis.

| Rango | Nota | Topes |
| --- | --- | --- |
| S | ≥ 92 | Solo sin faltas críticas |
| A | 80–91 | — |
| B | 65–79 | Máximo si hubo paro o necrosis térmica |
| C | 50–64 | Máximo si se implantó un tornillo contaminado |
| F | < 50 | Automático si Valerio tomó el control |

Reto de Valerio cumplido: +3 a la nota. Pantalla final: nota por componente, 3 peores momentos, ficha educativa.

### HuesoCoins y Reputación
Ingreso = tarifa × multiplicador (S 2,0 · A 1,5 · B 1,0 · C 0,6 · F 0,2) + propina − costes. Costes: tornillo caído 15 HC, placa desperdiciada 60 HC, unidad de sangre 40 HC.
Reputación 0–5 estrellas: media de los últimos 3 rangos (S=5, A=4, B=3, C=2, F=0.5) + 0,1 por clip viral (máx +0,5) + satisfacción de dueños. Casos de dificultad 4–5 exigen 3 estrellas.

### Boutique (solo HuesoCoins ganadas, sin micropagos; ventajas ≤ 20%)
| id | Artículo | HC | Efecto |
| --- | --- | --- | --- |
| gargantilla-estrella | Gargantilla con candado de estrella | 150 | Mensajes duran 30 s |
| botas-antideslizantes | Botas de plataforma antideslizantes | 200 | No resbalas en la clínica |
| anillas-oro-rosa | Anillas en D de oro rosa | 250 | +1 ranura de instrumental |
| fusta-pompon | Fusta con borla de pompón | 300 | Dómina cuesta 12 |
| esposas-arcoiris | Esposas de felpa arcoíris | 350 | 10 s de aspiración autónoma, 1 vez por cirugía (tecla H) |
| arnes-menta | Arnés shibari menta | 400 | −10% temblor con Concentración baja |
| skin-bisturi-gatito | Bisturí con mango de gatito | 120 | Cosmético |
| skin-taladro-conejo | Taladro con orejas de conejo | 200 | Cosmético |
| gorros-corazones | Gorros quirúrgicos de corazones | 180 | +5 moral del equipo |

## 6. Casos (8)

| # | Paciente (dueño) | Diagnóstico | Procedimiento | Dif. | HC | Mecánica nueva |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Panchito, chihuahua 2,1 kg (Don Braulio) | Fractura distal de radio y cúbito | Miniplaca bloqueada | 1 | 100 | Tutorial. Sin temblor de Fritz ni caos. Después lleva el cono todo el juego |
| 1 | Duquesa, gata común 4 kg (vecina de Gigi) | Síndrome del gato paracaidista: fractura conminuta de fémur | Placa-clavo en puente ("abrir pero no tocar") | 2 | 250 | Tocar esquirlas penaliza; radiografía de tórax obligatoria |
| 2 | Merengue, caniche toy 3,5 kg (Doña Hortensia) | Legg-Calvé-Perthes | Ostectomía de cabeza y cuello femoral (FHO) | 2 | 250 | Sierra oscilante; el ruido dispara la Histeria de Hortensia |
| 3 | Sir Winston, bulldog inglés 24 kg (Lord Pardo) | Luxación patelar medial grado III | Trocleoplastia en bloque + transposición de la tuberosidad tibial | 3 | 400 | Tallar y encajar el bloque; selfies de Gigi al máximo |
| 4 | Chorizo, teckel 7 kg (Rodrigo) | Hernia discal Hansen I T13–L1, dolor profundo conservado | Hemilaminectomía | 4 | 600 | Fresa a 1 mm de la médula; Rodrigo no hace solos (llora) |
| 5 | Tanque, pit bull 32 kg (Yeni) | Rotura del ligamento cruzado craneal | TPLO | 4 | 600 | Sierra birradial y rotación de meseta (28° → 5°); caso impuesto por Valerio |
| 6 | Copito, conejo enano 1,3 kg (profesor Anselmo) | Fractura de tibia | Fijador esquelético externo con agujas finas | 4 | 600 | Modo Micro: zoom 3×, temblor ×2; hipotermia |
| 7 | Rayo, border collie 19 kg (Dr. Valerio) | Hiperextensión del carpo (fibrocartílago palmar roto) | Artrodesis pancarpiana con placa dorsal híbrida + injerto esponjoso | 5 | 900 | Sin guías, Valerio en la sala, injerto del húmero |

Final: Valerio confía su perro a Emiliana y al terminar dice "Buen trabajo, doctora." (respeto profesional, nunca el elogio de la pareja).

### Fichas educativas (datos aproximados, pendientes de revisión veterinaria)
- Panchito: en razas toy el radio distal está poco irrigado; con solo escayola son frecuentes el retraso de consolidación y la no unión → se prefiere placa. El cono evita que se lama.
- Duquesa: en caídas desde altura primero se descarta trauma torácico (neumotórax, contusión pulmonar). La osteosíntesis biológica no manipula los fragmentos; el clavo ocupa ~30–40% del canal medular.
- Merengue: necrosis avascular de la cabeza femoral en razas pequeñas jóvenes (típicamente < 1 año). Tras retirar la cabeza se forma una falsa articulación fibrosa; la fisioterapia temprana decide el resultado.
- Sir Winston: la luxación patelar se gradúa de I a IV. La recesión profundiza el surco troclear; la transposición realinea el mecanismo extensor del cuádriceps.
- Chorizo: razas condrodistróficas degeneran el disco pronto. Conservar el dolor profundo es el mayor factor pronóstico; la cirugía descomprime retirando lámina y material discal.
- Tanque: la TPLO nivela la meseta tibial a ~5° para neutralizar el empuje tibial craneal. Se revisa el menisco medial.
- Copito: corticales finas, esqueleto ligero (~7–8% del peso vs 12–13% del gato) → se fisura fácil. Tras la cirugía debe comer pronto (estasis gastrointestinal).
- Rayo: el carpo se fusiona en ligera extensión (~10–12°). El injerto acelera la fusión; suele retirarse del agility de alto nivel.

## 7. Progresión y dificultad

| Semana | Caso | Instrumental nuevo | Caos nuevo | Desbloqueo |
| --- | --- | --- | --- | --- |
| 0 | Panchito | Bisturí, aspiración, tornillos | Ninguno | Boutique |
| 1 | Duquesa | Cauterio, separadores | Solo de Guitarra | Mensajes de la pareja |
| 2 | Merengue | Sierra oscilante | Temblor completo de Fritz; Histeria | Respiración |
| 3 | Sir Winston | Osteotomía en bloque | Selfie Cialítica | Clips virales |
| 4 | Chorizo | Fresa | Aluminio de Braulio | Voz Firme y Dulce |
| 5 | Tanque | Sierra birradial y rotación | Mirada de Auditor y Reto | — |
| 6 | Copito | Modo Micro | Hipotermia | — |
| 7 | Rayo | Injerto, doble campo | Todo, sin guías | Final |

Guías: completas semanas 0–2, solo inicio/fin 3–6, ninguna en la 7 y en Jefe de Servicio. Residente: guías completas siempre + imán suave 30%.

| Modo | Guías | Sangrado | Caos | Reanimaciones |
| --- | --- | --- | --- | --- |
| Residente | Completas + imán 30% | −40% | Nunca simultáneas | 2 |
| Especialista | Según semana | Normal | Hasta 2 desde semana 5 | 1 |
| Jefe de Servicio | Ninguna; tiempo objetivo −20% | +25% | Valerio mira el doble; S exige su reto | 1 |

Accesibilidad: gore 0–100 y Modo Pastel; remapeo (futuro); temblor ajustable hasta 0; ventanas rítmicas ×1,5/×2; pausa en cualquier momento; formas además de colores en constantes; reducción de destellos; subtítulos con efectos descritos ("[SLURP viscoso]"); volumen ASMR independiente.

## 8. HUD (quirófano)
- Arriba izquierda: monitor de constantes (ECG, FC, SpO₂, PAM, EtCO₂, T) con marco pastel de corazón; fuera de rango parpadea despacio. Debajo: Éxito % como corazón-batería (< 25% late y se agrieta; 0 se rompe → RCP).
- Arriba centro: Progreso % en segmentos por fase; la fase activa despliega su checklist; segmento completado → menta con brillo.
- Arriba derecha: Valerio (retrato, bocadillo, ojos brillan en la Mirada, nota provisional S–F; oculta en Jefe).
- Izquierda: Nivel de Campo como tubo de ensayo, línea de inundación al 70%, icono de Rodrigo aspirando.
- Derecha: Emiliana: Concentración (aro lila alrededor del retrato) y Reserva (candado de corazón que se agrieta en crisis); rubor al leer mensaje.
- Abajo izquierda: Rodrigo, Fritz, Gigi con estado, moral y tecla; quien causa el problema se ilumina.
- Abajo centro: 6 ranuras con forma de anilla en D (7 con anillas de oro rosa); contaminado = gris.
- Abajo derecha: reloj con anillo de cuenta atrás (20 s) y tarjeta del mensaje.
- Sobre la herida: guía punteada, anillos de sangrado, anillo de calor de la broca (verde/amarillo/rojo, marca en 47 °C), silueta fantasma, ventana del tornillo, capa actual del bisturí.
- Máx. 2 alertas a la vez: paro > arterial > calor óseo > equipo > comentario. Modo Inmersivo oculta la interfaz 2D.

## 9. Sonido (procedural, WebAudio)
| Sonido | Onomatopeya | Parámetros | Construcción |
| --- | --- | --- | --- |
| Bisturí | sssk | velocidad, capa, presión | ruido filtrado granular; grasa blanda, fascia con "pop" |
| Electrocauterio | tzzzt | contacto | zumbido + chisporroteo; a los 3 s cruje a quemado |
| Aspiración | SLURP | profundidad del charco | silbido en vacío, gorgoteo sumergida, sorbo de pajita al vaciar |
| Separadores | squelch + clic | apertura | trinquete + chapoteo viscoelástico |
| Reducción | crunch | fuerza | crepitación; al encajar "clonk" grave |
| Taladro | brrrr-zzzt | RPM, carga, temperatura | tono baja en cortical, sube en médula, cae en seco al atravesar la segunda cortical; siseo > 47 °C |
| Sierra | zzzz-zzt | carga, irrigación | oscilación aguda; más húmeda y grave con irrigación |
| Tornillo | tic-tic-CLAC | torque | rosca + clic del limitador; si cae "tin-tin-tin" + gemido de Fritz |
| Sutura/vendaje | zip, tink, riip | tensión | hilo, nudo, venda cohesiva |
| Monitor | BEEP-BEEP | FC, SpO₂ | ritmo = FC; tono baja cuando baja la SpO₂ |
| Desfibrilador | iiiii-THUMP | carga | carga ascendente + golpe sordo |
| Fusta | CHAS | — | chasquido seco |
| Mensaje | ding + latido | — | carillón kawaii + latido que se calma |

Música adaptativa en capas sobre un reloj de 100–120 BPM (coincide con la RCP): clínica lo-fi kawaii; quirófano estable electrónica pastel 110 BPM; Rodrigo en groove añade bajo y guitarra grunge; tensión con cuerdas y percusión; paro: solo monitor y riff de compresiones; rango S coro kawaii + acorde.

Voces: subtítulos siempre; síntesis de voz del navegador opcional (es-MX/es-ES). Frases de ejemplo: Emiliana "Rodrigo. Cánula. Ahora. (susurro) Gracias, cielo."; Valerio "Primum non nocere, doctora. Tómeselo como sugerencia."; Rodrigo "¡Aspiración en re menor, jefa!"; Fritz "T-t-tornillo de 2,7… ¡no, no, no!"; Gigi "¡Hola, mis huesitos! Hoy toca placa bloqueada, ¿sí?"; Hortensia "¡Merengue es lo único que me queda!"; Braulio "Ese tornillo lleva chip, doctora. Yo lo sé."
Frases cortas con prioridad y enfriamiento mínimo de 8 s por personaje; sin repetir la misma frase seguida.
