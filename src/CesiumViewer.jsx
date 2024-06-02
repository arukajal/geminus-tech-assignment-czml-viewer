import React, { useState, useEffect, useRef } from 'react';
import { twoline2satrec, propagate, gstime, degreesToRadians, eciToGeodetic, geodeticToEcf } from 'satellite.js';

/* global Cesium */

const tleLine1 = '1 25544U 98067A   21275.51251685  .00001419  00000-0  32216-4 0  9993';
const tleLine2 = '2 25544  51.6441  51.4465 0002207 282.8304 220.1671 15.48935791293993';

const calculatePositionAtTime = (tleLine1, tleLine2, date) => {
  const satellite = twoline2satrec(tleLine1, tleLine2);
  const positionAndVelocity = propagate(satellite, date);
  if (!positionAndVelocity.position || !positionAndVelocity.velocity) {
    console.error('Invalid position and velocity', positionAndVelocity);
    return { x: NaN, y: NaN, z: NaN };
  }
  const positionEci = positionAndVelocity.position;
  const gmst = gstime(date);
  const positionGd = eciToGeodetic(positionEci, gmst);
  const longitude = degreesToRadians(positionGd.longitude);
  const latitude = degreesToRadians(positionGd.latitude);
  const height = positionGd.height * 1000;
  const cartesianPosition = geodeticToEcf({ longitude, latitude, height });
  return { ...cartesianPosition, height };
};

const calculateFovFootprint = (height, fovAngle) => {
  const fovRadius = height * Math.tan(degreesToRadians(fovAngle / 2));
  const footprintArea = Math.PI * fovRadius * fovRadius / 1000000;
  return footprintArea.toFixed(2);
};

const CesiumViewer = () => {
  const [satelliteColor, setSatelliteColor] = useState(Cesium.Color.RED);
  const [fovColor, setFovColor] = useState(Cesium.Color.BLUE.withAlpha(0.5));
  const [footprintArea, setFootprintArea] = useState(0);
  const viewerRef = useRef(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  useEffect(() => {
    const {
      Viewer,
      CallbackProperty,
      Cartesian3,
      CzmlDataSource,
      JulianDate,
      Entity,
      VelocityOrientationProperty,
      SampledPositionProperty,
      ScreenSpaceEventHandler,
      ScreenSpaceEventType,
      HeightReference,
      CylinderGraphics,
      Color,
    } = window.Cesium;

    const viewer = new Viewer('cesiumContainer', {
      shouldAnimate: true,
      imageryProvider: new Cesium.IonImageryProvider({ assetId: 2 }),
    });

    viewerRef.current = viewer;

    if (!viewer) {
      console.error('Cesium Viewer initialization failed.');
      return;
    }

    const positionProperty = new SampledPositionProperty();

    for (let i = 0; i < 3600; i += 10) {
      const julianDate = JulianDate.addSeconds(JulianDate.now(), i, new JulianDate());
      const date = JulianDate.toDate(julianDate);
      const position = calculatePositionAtTime(tleLine1, tleLine2, date);
      if (isFinite(position.x) && isFinite(position.y) && isFinite(position.z)) {
        positionProperty.addSample(julianDate, new Cartesian3(position.x, position.y, position.z));
        const footprint = calculateFovFootprint(position.height, 45);
        setFootprintArea(footprint);
      } else {
        console.error('Invalid Cartesian coordinates', position);
      }
    }

    const satelliteEntity = viewer.entities.add(new Entity({
      position: positionProperty,
      point: { pixelSize: 5, color: satelliteColor },
      orientation: new VelocityOrientationProperty(positionProperty),
    }));

    const pathEntity = viewer.entities.add(new Entity({
      polyline: {
        positions: positionProperty,
        width: 2,
        material: Color.YELLOW,
      },
    }));

    const fovEntity = viewer.entities.add(new Entity({
      position: positionProperty,
      orientation: new VelocityOrientationProperty(positionProperty),
      cylinder: new CylinderGraphics({
        length: new CallbackProperty(() => {
          const lastPosition = positionProperty.getValue(JulianDate.now());
          const length = lastPosition ? Cartesian3.magnitude(lastPosition) * 1.5 : 0;
          return length;
        }, false),
        topRadius: 0,
        bottomRadius: new CallbackProperty(() => {
          const lastPosition = positionProperty.getValue(JulianDate.now());
          const height = lastPosition ? Cartesian3.magnitude(lastPosition) : 0;
          const bottomRadius = height * Math.tan(Cesium.Math.toRadians(22.5));
          return bottomRadius;
        }, false),
        material: fovColor,
        heightReference: HeightReference.NONE,
      }),
    }));

    viewer.clock.onTick.addEventListener(() => {
      const currentJulianDate = viewer.clock.currentTime;
      const currentCartesianPosition = positionProperty.getValue(currentJulianDate);
      if (currentCartesianPosition) {
        const currentHeight = Cartesian3.magnitude(currentCartesianPosition);
        const footprint = calculateFovFootprint(currentHeight, 45);
        setFootprintArea(footprint);
      }
    });

    const czmlDataSource = new CzmlDataSource();
    czmlDataSource.load('/simple.czml').then((dataSource) => {
      console.log('Loaded CZML Data Source:', dataSource);
      const viewer = viewerRef.current;
      if (viewer && viewer.dataSources) {
        viewer.dataSources.add(dataSource);
        console.log('CZML Data Source added to viewer:', viewer.dataSources);

        dataSource.entities.values.forEach(entity => {
          console.log('Entity ID:', entity.id);
        });

        const satelliteEntity = dataSource.entities.getById('Satellite/Geoeye1');

        if (satelliteEntity && satelliteEntity.position) {
          const positionProperty = satelliteEntity.position;

          const fovEntity = viewer.entities.add(new Entity({
            position: positionProperty,
            orientation: new VelocityOrientationProperty(positionProperty),
            show: true,
            cylinder: new CylinderGraphics({
              length: new CallbackProperty(() => {
                const lastPosition = positionProperty.getValue(JulianDate.now());
                if (!lastPosition) return 1000000;
                const length = Cartesian3.magnitude(lastPosition) * 1.5;
                console.log('Cylinder length:', length);
                return length;
              }, false),
              topRadius: 0,
              bottomRadius: new CallbackProperty(() => {
                const lastPosition = positionProperty.getValue(JulianDate.now());
                if (!lastPosition) return 500000;
                const height = Cartesian3.magnitude(lastPosition);
                const bottomRadius = height * Math.tan(Cesium.Math.toRadians(22.5));
                console.log('Cylinder bottomRadius:', bottomRadius);
                return bottomRadius;
              }, false),
              material: fovColor,
              heightReference: HeightReference.NONE,
              outline: true,
              outlineColor: Color.BLACK
            }),
          }));

          console.log('FOV Entity added:', fovEntity);

          viewer.clock.onTick.addEventListener(() => {
            const currentJulianDate = viewer.clock.currentTime;
            const currentCartesianPosition = positionProperty.getValue(currentJulianDate);
            if (currentCartesianPosition) {
              const currentHeight = Cartesian3.magnitude(currentCartesianPosition);
              const footprint = calculateFovFootprint(currentHeight, 45);
              setFootprintArea(footprint);
            }
          });
        } else {
          console.error('Satellite entity not found or missing position property.');
        }
      } else {
        console.error('viewer.dataSources is not accessible');
      }
    }).catch((error) => {
      console.error('Error loading CZML:', error);
    });

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const pickedObject = viewer.scene.pick(movement.endPosition);
      if (Cesium.defined(pickedObject) && pickedObject.id) {
        setHoverInfo(pickedObject.id.name || pickedObject.id.id);
      } else {
        setHoverInfo(null);
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    return () => {
      viewer.destroy();
      handler.destroy();
    };
  }, [satelliteColor, fovColor]);

  const handleSatelliteColorChange = (event) => {
    setSatelliteColor(Cesium.Color.fromCssColorString(event.target.value));
  };

  const handleFovColorChange = (event) => {
    setFovColor(Cesium.Color.fromCssColorString(event.target.value).withAlpha(0.5));
  };

  

  return (
    <div>
      <div id="cesiumContainer" style={{ width: '100%', height: '90vh' }}></div>
      <div style={{ padding: '10px' }}>
        <label>
          Satellite Color:
          <input type="color" onChange={handleSatelliteColorChange} />
        </label>
        <label>
          FOV Color:
          <input type="color" onChange={handleFovColorChange} />
        </label>
        <div>FOV Footprint Area: {footprintArea} km²</div>
        {hoverInfo && <div>Hovered over: {hoverInfo}</div>}
      </div>
    </div>
  );
};

export default CesiumViewer;
