use bevy::{prelude::*, render::camera::Exposure, time::{Stopwatch, Timer, TimerMode}, window::CursorGrabMode};
use bevy_diagnostic::{DiagnosticsStore, FrameTimeDiagnosticsPlugin};
use bevy_fps_controller::controller::*;
use bevy_rapier3d::prelude::*;
use rand::{distr::Uniform, prelude::*};
use std::f32::consts::TAU;

// Game constants
const SENSITIVITY_CM_PER_360: f32 = 10.0;
const MOUSE_DPI: f32 = 1600.0;
const ARENA_WIDTH: f32 = 200.0;
const ARENA_DEPTH: f32 = 200.0;
const ARENA_HEIGHT: f32 = 50.0;
// Position player in the middle of the arena, facing the front wall (negative Z)
const SPAWN_POINT: Vec3 = Vec3::new(0.0, 1.625, 0.0);
const WALL_THICKNESS: f32 = 1.0;
const TARGET_SIZE: f32 = 1.5;
const PLAYER_HEIGHT: f32 = 10.0;
const PLAYER_RADIUS: f32 = 0.5;
const CAMERA_HEIGHT_OFFSET: f32 = 4.0;
// Valorant uses a vertical FOV of 90 degrees (approximately 1.57 radians)
const CAMERA_FOV: f32 = std::f32::consts::FRAC_PI_2; // 90 degrees in radians
const CENTER_SIZE: f32 = 8.0;
const GRID_SPACING: f32 = 4.0;

// Scenario constants
const SCENARIO_DURATION: f32 = 30.0; // Duration of each scenario in seconds
const SCENARIO_DELAY: f32 = 5.0; // Delay between scenarios in seconds

// Component and resource definitions
#[derive(SystemSet, Debug, Hash, PartialEq, Eq, Clone)]
pub struct FpsControllerSetup;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum ScenarioType {
    // Clicking scenarios
    DynamicClicking,  // Targets move in unpredictable patterns
    StaticClicking,   // Targets are stationary
    LinearClicking,   // Targets move in straight lines

    // Tracking scenarios
    PreciseTracking,  // Slow, precise movements requiring accuracy
    ReactiveTracking, // Quick, sudden movements requiring fast reactions
    ControlTracking,  // Smooth, consistent movements requiring control

    // Switching scenarios
    SpeedSwitching,   // Fast target switching with emphasis on speed
    EvasiveSwitching, // Targets that try to evade the crosshair
    StabilitySwitching // Targets that require stability between switches
}

#[derive(Resource)]
struct ScenarioState {
    current_type: Option<ScenarioType>,
    scenario_timer: Timer,
    delay_timer: Timer,
    current_index: usize,
    is_active: bool,
    has_started: bool,
    scenarios: Vec<ScenarioType>,
}

impl Default for ScenarioState {
    fn default() -> Self {
        Self {
            current_type: None,
            scenario_timer: Timer::from_seconds(SCENARIO_DURATION, TimerMode::Once),
            delay_timer: Timer::from_seconds(SCENARIO_DELAY, TimerMode::Once),
            current_index: 0,
            is_active: false,
            has_started: false,
            scenarios: vec![
                ScenarioType::DynamicClicking,
                ScenarioType::StaticClicking,
                ScenarioType::LinearClicking,
                ScenarioType::PreciseTracking,
                ScenarioType::ReactiveTracking,
                ScenarioType::ControlTracking,
                ScenarioType::SpeedSwitching,
                ScenarioType::EvasiveSwitching,
                ScenarioType::StabilitySwitching,
            ],
        }
    }
}

#[derive(Debug, Clone, Default, Component, Reflect)]
#[reflect(Component, Default)]
pub struct Target;

#[derive(Component, Debug)]
struct TargetMovement {
    velocity: Vec3,
    pattern: MovementPattern,
    timer: f32,
    start_position: Vec3,
    max_speed: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MovementPattern {
    Static,   // No movement
    Linear,   // Simple linear movement with bouncing
    Circular, // Circular or figure-8 patterns
    Random,   // Random movement with direction changes
}

#[derive(Component)]
struct ScenarioDisplay;

#[derive(Component)]
struct PointsDisplay;

#[derive(Component)]
struct FpsDisplay;

#[derive(Default, Resource)]
struct Points { pub value: i32 }

#[derive(Component)]
struct ShootTracker { stopwatch: Stopwatch }

pub fn main() {
    // For Windows, we need to use a different approach
    #[cfg(target_os = "windows")]
    {
        // This allows Winit to run on any thread on Windows
        std::env::set_var("WINIT_EXTERNAL_EVENT_LOOP", "true");
    }

    // Create the app
    let mut app = App::new();

    // Add resources
    app.insert_resource(AmbientLight { color: Color::WHITE, brightness: 2000.0 })
       .insert_resource(ClearColor(Color::srgb(0.1, 0.1, 0.15)))
       .insert_resource(Points::default())
       .insert_resource(ScenarioState::default())
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: String::from("Aim Trainer"),
                present_mode: bevy::window::PresentMode::Immediate,
                ..default()
            }),
            ..default()
        }))
        .add_plugins((FrameTimeDiagnosticsPlugin::default(),
                     RapierPhysicsPlugin::<NoUserData>::default(), FpsControllerPlugin))
        .add_systems(Startup, (setup, fps_controller_setup.in_set(FpsControllerSetup)))
        .add_systems(Update, (
            respawn,
            manage_cursor,
            click_targets,
            update_displays,
            manage_scenarios,
            update_target_movements,
        ))
        .run();
}



// Setup player and camera
fn fps_controller_setup(mut commands: Commands) {
    // Calculate sensitivity based on cm/360
    let sensitivity = TAU / (SENSITIVITY_CM_PER_360 / 2.54 * MOUSE_DPI);

    // Create player entity
    let player = commands.spawn_empty()
        .insert(Collider::cylinder(PLAYER_HEIGHT / 2.0, PLAYER_RADIUS))
        .insert(Friction { coefficient: 0.0, combine_rule: CoefficientCombineRule::Min })
        .insert(Restitution { coefficient: 0.0, combine_rule: CoefficientCombineRule::Min })
        .insert(ActiveEvents::COLLISION_EVENTS)
        .insert(Velocity::zero())
        .insert(RigidBody::Dynamic)
        .insert(Sleeping::disabled())
        .insert(LockedAxes::ROTATION_LOCKED)
        .insert(AdditionalMassProperties::Mass(1.0))
        .insert(GravityScale(0.0))
        .insert(Ccd { enabled: true })
        .insert(Transform::from_translation(SPAWN_POINT))
        .insert(LogicalPlayer)
        .insert(FpsControllerInput { pitch: 0.0, yaw: 0.0, ..default() })
        .insert(FpsController { air_acceleration: 80.0, sensitivity, ..default() })
        .insert(CameraConfig { height_offset: CAMERA_HEIGHT_OFFSET })
        .insert(ShootTracker { stopwatch: Stopwatch::new() })
        .insert(SpatialListener::new(0.5))
        .id();

    // Create camera entity linked to player
    commands.spawn((
        Camera3d::default(),
        Camera { order: 0, ..default() },
        Projection::Perspective(PerspectiveProjection { fov: CAMERA_FOV, ..default() }),
        Exposure::SUNLIGHT,
        RenderPlayer { logical_entity: player },
    ));
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut materials2d: ResMut<Assets<ColorMaterial>>,
) {
    // Setup 2D camera for UI
    commands.spawn((Camera2d, Camera { order: 2, ..default() }));

    // Setup lighting
    // Main directional light
    commands.spawn((DirectionalLight { illuminance: light_consts::lux::OVERCAST_DAY, shadows_enabled: true, ..default() },
                   Transform::from_xyz(0.0, 40.0, 0.0).looking_at(Vec3::ZERO, Vec3::Z)));

    // Center light
    commands.spawn((PointLight { color: Color::srgb(0.9, 0.9, 1.0), intensity: 10000.0, range: 120.0, ..default() },
                   Transform::from_xyz(0.0, 20.0, 0.0)));

    // Corner lights
    for (x, z) in [(-ARENA_WIDTH/4.0, -ARENA_DEPTH/4.0), (ARENA_WIDTH/4.0, -ARENA_DEPTH/4.0),
                  (-ARENA_WIDTH/4.0, ARENA_DEPTH/4.0), (ARENA_WIDTH/4.0, ARENA_DEPTH/4.0)] {
        commands.spawn((PointLight { color: Color::srgb(0.8, 0.8, 1.0), intensity: 5000.0, range: 80.0, ..default() },
                       Transform::from_xyz(x, 20.0, z)));
    }

    // Setup materials
    let ground = materials.add(StandardMaterial {
        base_color: Color::srgb(0.15, 0.15, 0.15), perceptual_roughness: 0.9, cull_mode: None, ..default()
    });
    let wall = materials.add(StandardMaterial {
        base_color: Color::srgb(0.2, 0.2, 0.25), perceptual_roughness: 0.8, cull_mode: None, ..default()
    });
    let grid = materials.add(StandardMaterial {
        base_color: Color::srgb(0.3, 0.3, 0.35), emissive: Color::srgb(0.3, 0.3, 0.35).into(),
        unlit: true, ..default()
    });
    let center_floor = materials.add(StandardMaterial {
        base_color: Color::srgb(1.0, 0.0, 0.0), emissive: Color::srgb(0.5, 0.0, 0.0).into(),
        perceptual_roughness: 0.3, metallic: 0.2, reflectance: 0.5, cull_mode: None, ..default()
    });

    // Setup arena
    // Main ground collider and floor
    commands.spawn((Collider::cuboid(ARENA_WIDTH/2.0, 0.1, ARENA_DEPTH/2.0), RigidBody::Fixed,
                   Transform::from_translation(Vec3::new(0.0, -0.5, 0.0))));
    commands.spawn((Mesh3d(meshes.add(Cuboid::new(ARENA_WIDTH, 0.1, ARENA_DEPTH))),
                   MeshMaterial3d(ground.clone()),
                   Transform::from_translation(Vec3::new(0.0, -0.5, 0.0))));

    // Center floor (red)
    commands.spawn((Mesh3d(meshes.add(Cuboid::new(CENTER_SIZE, 0.1, CENTER_SIZE))),
                   MeshMaterial3d(center_floor),
                   Transform::from_translation(Vec3::new(0.0, -0.44, 0.0))));

    // Grid lines
    let line_thickness = 0.2;
    let line_height = 0.05;
    let half_width = ARENA_WIDTH / 2.0;
    let half_depth = ARENA_DEPTH / 2.0;

    // X-axis grid lines
    for x in (-half_width as i32..=half_width as i32).step_by(GRID_SPACING as usize) {
        commands.spawn((Mesh3d(meshes.add(Cuboid::new(line_thickness, line_height, ARENA_DEPTH))),
                       MeshMaterial3d(grid.clone()),
                       Transform::from_translation(Vec3::new(x as f32, -0.45, 0.0))));
    }

    // Z-axis grid lines
    for z in (-half_depth as i32..=half_depth as i32).step_by(GRID_SPACING as usize) {
        commands.spawn((Mesh3d(meshes.add(Cuboid::new(ARENA_WIDTH, line_height, line_thickness))),
                       MeshMaterial3d(grid.clone()),
                       Transform::from_translation(Vec3::new(0.0, -0.45, z as f32))));
    }

    // Walls and ceiling
    let wall_configs = [
        [ARENA_WIDTH, ARENA_HEIGHT, WALL_THICKNESS, 0.0, ARENA_HEIGHT/2.0 - 0.5, ARENA_DEPTH/2.0],
        [ARENA_WIDTH, ARENA_HEIGHT, WALL_THICKNESS, 0.0, ARENA_HEIGHT/2.0 - 0.5, -ARENA_DEPTH/2.0],
        [WALL_THICKNESS, ARENA_HEIGHT, ARENA_DEPTH, -ARENA_WIDTH/2.0, ARENA_HEIGHT/2.0 - 0.5, 0.0],
        [WALL_THICKNESS, ARENA_HEIGHT, ARENA_DEPTH, ARENA_WIDTH/2.0, ARENA_HEIGHT/2.0 - 0.5, 0.0],
        [ARENA_WIDTH, WALL_THICKNESS, ARENA_DEPTH, 0.0, ARENA_HEIGHT - 0.5, 0.0]
    ];

    for [width, height, depth, x, y, z] in wall_configs {
        commands.spawn((Collider::cuboid(width/2.0, height/2.0, depth/2.0), RigidBody::Fixed,
                       Transform::from_translation(Vec3::new(x, y, z))));
        commands.spawn((Mesh3d(meshes.add(Cuboid::new(width, height, depth))),
                       MeshMaterial3d(wall.clone()),
                       Transform::from_translation(Vec3::new(x, y, z))));
    }

    // Spawn initial targets
    for _ in 0..10 {
        spawn_random_target(&mut commands, &mut meshes, &mut materials);
    }

    // UI elements - dot crosshair
    let crosshair_material = materials2d.add(Color::srgb(0.0, 1.0, 1.0));
    let dot_size = 2.0; // Size of the dot in pixels
    commands.spawn((Mesh2d(meshes.add(Cuboid::new(dot_size, dot_size, 0.0))),
                   MeshMaterial2d(crosshair_material),
                   Transform::default()));

    // Text displays
    commands.spawn((Text::new("Points: 0"),
                   Node { position_type: PositionType::Absolute, bottom: Val::Px(5.), left: Val::Px(15.), ..default() },
                   PointsDisplay));
    commands.spawn((Text::new("FPS: 0"),
                   Node { position_type: PositionType::Absolute, top: Val::Px(5.), right: Val::Px(15.), ..default() },
                   FpsDisplay));
    commands.spawn((Text::new(format!("Sensitivity: {:.1} cm/360 @ {} DPI", SENSITIVITY_CM_PER_360, MOUSE_DPI as i32)),
                   Node { position_type: PositionType::Absolute, bottom: Val::Px(5.), right: Val::Px(15.), ..default() }));
    commands.spawn((Text::new("Press SPACE to start scenarios"),
                   Node { position_type: PositionType::Absolute, top: Val::Px(50.), left: Val::Px(15.), ..default() },
                   ScenarioDisplay));
}

fn respawn(mut query: Query<(&mut Transform, &mut Velocity)>) {
    for (mut transform, mut velocity) in &mut query {
        if transform.translation.y <= -50.0 {
            velocity.linvel = Vec3::ZERO;
            transform.translation = SPAWN_POINT;
        }
    }
}

fn manage_cursor(
    btn: Res<ButtonInput<MouseButton>>,
    key: Res<ButtonInput<KeyCode>>,
    mut window_query: Query<&mut Window>,
    mut controller_query: Query<&mut FpsController>,
) {
    let Ok(mut window) = window_query.get_single_mut() else { return };
    let Ok(mut controller) = controller_query.get_single_mut() else { return };

    if btn.just_pressed(MouseButton::Left) {
        set_cursor_state(&mut window, &mut controller, true);
    } else if key.just_pressed(KeyCode::Escape) {
        set_cursor_state(&mut window, &mut controller, false);
    }
}

fn set_cursor_state(window: &mut Window, controller: &mut FpsController, gameplay_active: bool) {
    window.cursor_options.grab_mode = if gameplay_active { CursorGrabMode::Locked } else { CursorGrabMode::None };
    window.cursor_options.visible = !gameplay_active;
    controller.enable_input = gameplay_active;
}

fn click_targets(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    rapier_context: ReadRapierContext,
    player_query: Query<Entity, With<LogicalPlayer>>,
    camera: Query<&Transform, With<RenderPlayer>>,
    buttons: Res<ButtonInput<MouseButton>>,
    targets: Query<Entity, With<Target>>,
    mut points: ResMut<Points>,
    mut shoot_stopwatch: Query<&mut ShootTracker>,
    time: Res<Time>,
) {
    // Get player and check if we can shoot
    let player_handle = player_query.single();
    let mut shoot_tracker = shoot_stopwatch.get_mut(player_handle).unwrap();
    shoot_tracker.stopwatch.tick(time.delta());

    // Early returns if not shooting or on cooldown
    if !buttons.pressed(MouseButton::Left) || shoot_tracker.stopwatch.elapsed_secs() <= 0.1 {
        return;
    }

    // Cast ray from camera
    let camera_transform = camera.single();
    let ray_pos = camera_transform.translation;
    let ray_dir = camera_transform.forward().as_vec3();
    let max_distance = (ARENA_WIDTH.powi(2) + ARENA_DEPTH.powi(2) + ARENA_HEIGHT.powi(2)).sqrt() * 1.5;

    // Process hit and reset cooldown
    let filter = QueryFilter::new().exclude_sensors().exclude_rigid_body(player_handle);
    process_hit_result(
        rapier_context.single().cast_ray(ray_pos, ray_dir, max_distance, true, filter),
        &mut commands, &mut meshes, &mut materials, &targets, &mut points
    );
    shoot_tracker.stopwatch.reset();
}

fn process_hit_result(
    hit_result: Option<(Entity, f32)>,
    commands: &mut Commands,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
    targets: &Query<Entity, With<Target>>,
    points: &mut ResMut<Points>,
) {
    // Adjust points based on hit result
    match hit_result {
        Some((entity, _)) if targets.get(entity).is_ok() => {
            // Hit a target - add point, despawn it, spawn a new one
            commands.entity(entity).despawn_recursive();
            spawn_random_target(commands, meshes, materials);
            points.value += 1;
        },
        _ => points.value -= 1, // Missed or hit non-target - subtract point
    }
}

// Update all UI displays
fn update_displays(
    points: Res<Points>,
    diagnostics: Res<DiagnosticsStore>,
    mut points_query: Query<&mut Text, With<PointsDisplay>>,
    mut fps_query: Query<&mut Text, (With<FpsDisplay>, Without<PointsDisplay>)>,
    mut scenario_query: Query<&mut Text, (With<ScenarioDisplay>, Without<PointsDisplay>, Without<FpsDisplay>)>,
    scenario_state: Res<ScenarioState>,
) {
    // Update points display
    if let Ok(mut text) = points_query.get_single_mut() {
        text.0 = format!("Points: {}", points.value);
    }

    // Update FPS display
    if let Ok(mut text) = fps_query.get_single_mut() {
        let fps = diagnostics.get(&FrameTimeDiagnosticsPlugin::FPS)
            .and_then(|fps| fps.smoothed())
            .map_or(0, |v| v as i32);
        text.0 = format!("FPS: {}", fps);
    }

    // Update scenario display
    if let Ok(mut text) = scenario_query.get_single_mut() {
        text.0 = if !scenario_state.has_started {
            "Press SPACE to start scenarios".to_string()
        } else if scenario_state.is_active {
            let scenario_type = scenario_state.current_type.unwrap();
            let remaining = scenario_state.scenario_timer.remaining_secs();
            format!("Current: {:?} - {:.1}s", scenario_type, remaining)
        } else if scenario_state.current_index < scenario_state.scenarios.len() {
            let next_scenario = scenario_state.scenarios[scenario_state.current_index];
            let remaining = scenario_state.delay_timer.remaining_secs();
            format!("Next: {:?} - {:.1}s", next_scenario, remaining)
        } else {
            "All scenarios completed!".to_string()
        };
    }
}

fn manage_scenarios(mut scenario_state: ResMut<ScenarioState>, time: Res<Time>,
                   mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>,
                   mut materials: ResMut<Assets<StandardMaterial>>,
                   targets: Query<Entity, With<Target>>,
                   keyboard: Res<ButtonInput<KeyCode>>) {
    // Start the test sequence when the user presses Space
    if keyboard.just_pressed(KeyCode::Space) && !scenario_state.has_started {
        scenario_state.has_started = true;
        scenario_state.current_index = 0;
        scenario_state.is_active = false;
        scenario_state.delay_timer.reset();

        // Clear any existing targets
        for entity in &targets {
            commands.entity(entity).despawn_recursive();
        }

        println!("Starting aim test sequence. First scenario in {} seconds...", SCENARIO_DELAY);
        return;
    }

    // If test hasn't started, don't proceed
    if !scenario_state.has_started {
        return;
    }

    // Handle scenario state transitions
    if !scenario_state.is_active {
        // In delay between scenarios
        scenario_state.delay_timer.tick(time.delta());

        if scenario_state.delay_timer.just_finished() {
            // Start next scenario if available
            if scenario_state.current_index < scenario_state.scenarios.len() {
                let scenario_type = scenario_state.scenarios[scenario_state.current_index];
                scenario_state.current_type = Some(scenario_type);
                scenario_state.is_active = true;
                scenario_state.scenario_timer.reset();

                spawn_scenario_targets(&mut commands, &mut meshes, &mut materials, scenario_type, &targets);
                println!("Starting scenario: {:?}", scenario_type);
            } else {
                // All scenarios completed
                scenario_state.has_started = false;
                scenario_state.current_type = None;
                println!("All scenarios completed!");
            }
        }
    } else {
        // In active scenario
        scenario_state.scenario_timer.tick(time.delta());

        if scenario_state.scenario_timer.just_finished() {
            // End current scenario
            scenario_state.is_active = false;
            scenario_state.current_index += 1;
            scenario_state.delay_timer.reset();

            // Clear targets
            for entity in &targets {
                commands.entity(entity).despawn_recursive();
            }

            if scenario_state.current_index < scenario_state.scenarios.len() {
                println!("Scenario completed. Next scenario in {} seconds...", SCENARIO_DELAY);
            }
        } else if let Some(scenario_type) = scenario_state.current_type {
            // Update targets for current scenario
            update_scenario_targets(&mut commands, &mut meshes, &mut materials,
                                   scenario_type, time.delta_secs(), &targets);
        }
    }
}

// Spawn a target at a random position within the player's field of view
fn spawn_target_in_fov(commands: &mut Commands, meshes: &mut ResMut<Assets<Mesh>>,
                     materials: &mut ResMut<Assets<StandardMaterial>>,
                     pattern: Option<MovementPattern>, max_speed: Option<f32>) -> Vec3 {
    let mut rng = rand::rng();

    // If pattern not specified, choose a random one
    let pattern = pattern.unwrap_or_else(|| {
        let patterns = [MovementPattern::Static, MovementPattern::Linear,
                       MovementPattern::Circular, MovementPattern::Random];
        patterns[rng.random_range(0..patterns.len())]
    });

    // If max_speed not specified, choose a random one based on pattern
    let max_speed = max_speed.unwrap_or_else(|| {
        if pattern == MovementPattern::Static { 0.0 } else { rng.random_range(3.0..10.0) }
    });

    // Generate random position within FOV
    let z = -ARENA_DEPTH/2.0 + 5.0; // Near the front wall
    let fov_width = 2.0 * z.abs(); // Width of FOV at this distance
    let pos = Vec3::new(
        rng.sample(Uniform::new(-fov_width/2.0, fov_width/2.0).unwrap()),
        rng.sample(Uniform::new(5.0, ARENA_HEIGHT - 5.0).unwrap()),
        z
    );

    spawn_target_with_movement(commands, meshes, materials, pos, pattern, max_speed)
}

// Shorthand for spawning a random target
fn spawn_random_target(commands: &mut Commands, meshes: &mut ResMut<Assets<Mesh>>,
                     materials: &mut ResMut<Assets<StandardMaterial>>) {
    spawn_target_in_fov(commands, meshes, materials, None, None);
}

fn spawn_scenario_targets(commands: &mut Commands, meshes: &mut ResMut<Assets<Mesh>>,
                         materials: &mut ResMut<Assets<StandardMaterial>>, scenario_type: ScenarioType,
                         targets: &Query<Entity, With<Target>>) {
    // Clear any existing targets first
    for entity in targets.iter() {
        commands.entity(entity).despawn_recursive();
    }

    // Common values
    let z_wall = -ARENA_DEPTH/2.0 + 5.0; // 5 units from the wall

    // Spawn targets based on scenario type
    match scenario_type {
        ScenarioType::StaticClicking => {
            // Spawn 5 static targets in a circle
            for i in 0..5 {
                let angle = (i as f32) * (TAU / 5.0);
                spawn_target_with_movement(
                    commands, meshes, materials,
                    Vec3::new(z_wall.abs() * 0.8 * angle.cos(), 10.0 + (i as f32 * 3.0) % 15.0, z_wall),
                    MovementPattern::Static, 0.0
                );
            }
        },
        ScenarioType::DynamicClicking => {
            // Spawn 3 random moving targets
            for _ in 0..3 {
                spawn_target_in_fov(commands, meshes, materials, Some(MovementPattern::Random), Some(10.0));
            }
        },
        ScenarioType::LinearClicking => {
            // Spawn 3 targets in a row that move linearly
            for i in 0..3 {
                spawn_target_with_movement(
                    commands, meshes, materials,
                    Vec3::new((i as f32 - 1.0) * 15.0, 10.0 + (i as f32 * 5.0), z_wall),
                    MovementPattern::Linear, 5.0
                );
            }
        },
        // Single target tracking scenarios
        ScenarioType::PreciseTracking => {
            spawn_target_with_movement(commands, meshes, materials,
                                      Vec3::new(0.0, 15.0, z_wall), MovementPattern::Circular, 3.0);
        },
        ScenarioType::ReactiveTracking => {
            spawn_target_with_movement(commands, meshes, materials,
                                      Vec3::new(0.0, 15.0, z_wall), MovementPattern::Random, 15.0);
        },
        ScenarioType::ControlTracking => {
            spawn_target_with_movement(commands, meshes, materials,
                                      Vec3::new(0.0, 15.0, z_wall), MovementPattern::Circular, 8.0);
        },
        // Switching scenarios with multiple targets
        ScenarioType::SpeedSwitching | ScenarioType::StabilitySwitching => {
            spawn_multiple_targets(commands, meshes, materials, z_wall, MovementPattern::Static, 0.0);
        },
        ScenarioType::EvasiveSwitching => {
            spawn_multiple_targets(commands, meshes, materials, z_wall, MovementPattern::Random, 12.0);
        },
    }
}

// Helper function to spawn multiple targets in a row
fn spawn_multiple_targets(commands: &mut Commands, meshes: &mut ResMut<Assets<Mesh>>,
                        materials: &mut ResMut<Assets<StandardMaterial>>, z: f32,
                        pattern: MovementPattern, speed: f32) {
    for i in 0..3 {
        spawn_target_with_movement(
            commands, meshes, materials,
            Vec3::new((i as f32 - 1.0) * 20.0, 10.0 + (i as f32 * 5.0), z),
            pattern, speed
        );
    }
}

fn update_scenario_targets(commands: &mut Commands, meshes: &mut ResMut<Assets<Mesh>>,
                          materials: &mut ResMut<Assets<StandardMaterial>>,
                          scenario_type: ScenarioType, _delta_time: f32,
                          targets: &Query<Entity, With<Target>>) {
    // Only spawn new targets for DynamicClicking if we have fewer than 3
    if scenario_type == ScenarioType::DynamicClicking {
        let target_count = targets.iter().count();
        if target_count < 3 && rand::random::<f32>() < 0.1 {
            spawn_target_in_fov(commands, meshes, materials, Some(MovementPattern::Random), Some(10.0));
        }
    }
}

fn update_target_movements(time: Res<Time>, mut query: Query<(&mut Transform, &mut TargetMovement)>,
                          camera_query: Query<&Transform, (With<RenderPlayer>, Without<TargetMovement>)>) {
    let delta = time.delta_secs();
    let camera_transform = camera_query.get_single().ok();

    // Common boundary values
    let margin = 5.0;
    let z_min = -ARENA_DEPTH/2.0 + margin;
    let z_max = z_min + 30.0;

    for (mut transform, mut movement) in &mut query {
        movement.timer += delta;

        // Calculate FOV-based boundaries
        let fov_width = 2.0 * transform.translation.z.abs();
        let bounds_min = Vec3::new(-fov_width/2.0, 5.0, z_min);
        let bounds_max = Vec3::new(fov_width/2.0, ARENA_HEIGHT - 5.0, z_max);

        // Update position based on pattern
        match movement.pattern {
            MovementPattern::Static => {}, // No movement

            MovementPattern::Linear => {
                // Initialize velocity if needed
                if movement.velocity.length_squared() < 0.001 {
                    initialize_velocity(&mut movement, 0.0);
                }

                apply_velocity(&mut transform, &movement, delta);
                handle_boundary_collision(&mut transform, &mut movement, bounds_min, bounds_max);
            },

            MovementPattern::Circular => {
                // Circular pattern
                let radius = 15.0;
                let angle = movement.timer * (movement.max_speed / radius);

                transform.translation = Vec3::new(
                    movement.start_position.x + radius * angle.cos(),
                    movement.start_position.y + radius * 0.3 * angle.sin(),
                    -ARENA_DEPTH/2.0 + 15.0 + radius * 0.2 * (1.0 - angle.cos())
                );

                transform.translation = transform.translation.clamp(bounds_min, bounds_max);
            },

            MovementPattern::Random => {
                // Change direction occasionally
                if movement.velocity.length_squared() < 0.001 || movement.timer > 2.0 {
                    initialize_velocity(&mut movement, 0.2);
                    movement.timer = 0.0;
                }

                apply_velocity(&mut transform, &movement, delta);
                handle_boundary_collision(&mut transform, &mut movement, bounds_min, bounds_max);

                // Add evasion for high-speed targets
                if let Some(camera) = camera_transform {
                    if movement.max_speed > 10.0 {
                        let to_camera = (camera.translation - transform.translation).normalize();
                        let perpendicular = Vec3::new(to_camera.z, 0.0, -to_camera.x).normalize() * delta * 5.0;
                        transform.translation += perpendicular;
                        transform.translation = transform.translation.clamp(bounds_min, bounds_max);
                    }
                }
            },
        }
    }
}

// Helper to initialize velocity
fn initialize_velocity(movement: &mut TargetMovement, y_range: f32) {
    let mut rng = rand::rng();
    let y_component = if y_range > 0.0 {
        rng.sample(Uniform::new(-y_range, y_range).unwrap())
    } else {
        0.0 // No vertical movement if y_range is 0
    };

    movement.velocity = Vec3::new(
        rng.sample(Uniform::new(-1.0, 1.0).unwrap()),
        y_component,
        rng.sample(Uniform::new(-1.0, 1.0).unwrap())
    ).normalize() * movement.max_speed;
}

// Helper to apply velocity
fn apply_velocity(transform: &mut Transform, movement: &TargetMovement, delta: f32) {
    transform.translation += movement.velocity * delta;
}

// Handle boundary collisions with a single function
fn handle_boundary_collision(transform: &mut Transform, movement: &mut TargetMovement,
                           bounds_min: Vec3, bounds_max: Vec3) {
    // Check each axis and bounce if needed
    for i in 0..3 {
        if transform.translation[i] < bounds_min[i] || transform.translation[i] > bounds_max[i] {
            movement.velocity[i] = -movement.velocity[i];
        }
    }

    // Clamp position to boundaries
    transform.translation = transform.translation.clamp(bounds_min, bounds_max);
}

fn spawn_target_with_movement(commands: &mut Commands, meshes: &mut ResMut<Assets<Mesh>>,
                            materials: &mut ResMut<Assets<StandardMaterial>>, position: Vec3,
                            pattern: MovementPattern, max_speed: f32) -> Vec3 {
    // Create red glowing target
    let mut entity = commands.spawn((
        Collider::ball(TARGET_SIZE),
        RigidBody::Dynamic,
        GravityScale(0.0),
        Sleeping::disabled(),
        Transform::from_translation(position),
        Target,
        Mesh3d(meshes.add(Sphere::new(TARGET_SIZE))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(1.0, 0.1, 0.1),
            emissive: Color::srgb(1.0, 0.2, 0.2).into(),
            perceptual_roughness: 0.0, metallic: 0.5, reflectance: 1.0,
            ..default()
        })),
    ));

    // Add movement component if not static
    if pattern != MovementPattern::Static {
        entity.insert(TargetMovement {
            velocity: Vec3::ZERO,
            pattern,
            timer: 0.0,
            start_position: position,
            max_speed,
        });
    }

    position
}

