use caiven_vm::input::Input;
use caiven_vm::rendering::font::Font;
use caiven_vm::vm::Vm;
use caiven_vm::vm::config::VmConfig;

fn fresh_vm() -> (Vm, Input, Font) {
    (Vm::new(VmConfig::default()), Input::new(), Font::empty())
}

#[test]
fn load_data_with_no_prior_save_returns_empty_table() {
    let (mut vm, input, font) = fresh_vm();
    vm.load_lua_source(
        "local t = load_data(); local count = 0; for _ in pairs(t) do count = count + 1 end; assert(count == 0)",
        &input,
        &font,
    )
    .expect("load_data with nothing saved yet returns {}");
}

#[test]
fn save_data_load_data_round_trip() {
    let (mut vm, input, font) = fresh_vm();
    vm.load_lua_source(
        "save_data({ level = 3, name = 'ok' }); local t = load_data(); assert(t.level == 3); assert(t.name == 'ok')",
        &input,
        &font,
    )
    .expect("save_data/load_data round trip");
}

#[test]
fn save_data_over_size_cap_is_a_lua_error() {
    let (mut vm, input, font) = fresh_vm();
    let src = "save_data({ s = string.rep('x', 5000) })";
    let result = vm.load_lua_source(src, &input, &font);
    assert!(result.is_err(), "5000+ bytes must exceed the 4096-byte cap");
}

#[test]
fn save_data_marks_vm_save_data_dirty() {
    let (mut vm, input, font) = fresh_vm();
    assert!(!vm.save_data().is_dirty());
    vm.load_lua_source("save_data({ level = 1 })", &input, &font)
        .expect("save_data succeeds");
    assert!(vm.save_data().is_dirty());
}
