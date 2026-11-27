/*
 * Layer1's setup page inside OctoPrint's own UI (Settings > Layer1, and a step of the
 * first-run wizard; both show templates/layer1_setup.jinja2). This is not part of the
 * touch UI. It shows whether the kiosk service is installed and the screen is paired,
 * and in Settings it edits Layer1's settings (templates/layer1_settings.jinja2), which
 * are OctoPrint's settings for the plugin, so the dialog's Save button saves them.
 */
$(function () {
    // The name the touch UI asks for its application key under (APP_NAME in js/api.js)
    var APP_NAME = "Layer1";

    // A number field. Knockout's value binding writes strings, which OctoPrint would save
    // as "250"; this writes numbers, and puts the old value back on input that isn't one.
    ko.bindingHandlers.layer1Number = {
        init: function (element, valueAccessor, allBindings, viewModel, bindingContext) {
            var target = valueAccessor();
            if (!ko.isWriteableObservable(target)) return;
            var number = ko.pureComputed({
                read: target,
                write: function (value) {
                    var n = parseFloat(value);
                    if (isFinite(n)) {
                        target(n);
                    } else {
                        number.notifySubscribers(target());
                    }
                }
            });
            ko.applyBindingsToNode(element, {value: number}, bindingContext);
        }
    };

    function Layer1SetupViewModel(parameters) {
        var self = this;
        self.settingsViewModel = parameters[0];
        self.printerProfiles = parameters[1];

        // OctoPrint's settings for the plugin (plugins.layer1), as observables. Looked up
        // again when Settings opens, in case they weren't loaded yet when the page bound.
        self.s = ko.observable(null);
        var findSettings = function () {
            var plugins = self.settingsViewModel.settings && self.settingsViewModel.settings.plugins;
            var mine = (plugins && plugins.layer1) || null;
            if (mine !== self.s()) self.s(mine);
        };
        self.onBeforeBinding = findSettings;

        self.profileName = ko.pureComputed(function () {
            var data = self.printerProfiles && self.printerProfiles.currentProfileData;
            var name = data && ko.unwrap((ko.unwrap(data) || {}).name);
            return name ? "From the printer profile: " + name : "From the printer profile";
        });

        self.showPrinterProfiles = function () {
            $('a[href="#settings_printerProfiles"]').first().tab("show");
        };

        self.addPreset = function () {
            self.s().presets.push({name: ko.observable("New"), nozzle: ko.observable(200), bed: ko.observable(60)});
        };
        self.removePreset = function (preset) {
            var presets = self.s().presets;
            if (presets().length > 1) presets.remove(preset);
        };

        self.onSettingsBeforeSave = function () {
            var s = self.s();
            if (!s) return;
            // An empty name means "use the printer profile's", which the plugin reads as null
            var name = s.printer.name();
            if (typeof name === "string") s.printer.name(name.trim() || null);
        };

        self.kiosk = ko.observable(null); // "running" | "stopped" | "missing", null if unknown
        self.pairedUsers = ko.observable(null); // users who approved a Layer1 key, null if unknown
        self.appKeysOff = ko.observable(false);
        self.checking = ko.observable(false);

        self.kioskText = ko.pureComputed(function () {
            switch (self.kiosk()) {
                case "running":
                    return "Running";
                case "stopped":
                    return "Installed, not running";
                case "missing":
                    return "Not installed";
                default:
                    return self.checking() ? "Checking…" : "Unknown";
            }
        });
        self.kioskCss = ko.pureComputed(function () {
            return {running: "label-success", stopped: "label-warning"}[self.kiosk()] || "";
        });

        self.pairText = ko.pureComputed(function () {
            var users = self.pairedUsers();
            if (self.appKeysOff()) return "Application Keys plugin is off";
            if (users === null) return self.checking() ? "Checking…" : "Unknown";
            if (!users.length) return "Not paired";
            return "Paired, approved by " + users.join(", ");
        });
        self.pairCss = ko.pureComputed(function () {
            if (self.appKeysOff()) return "label-important";
            var users = self.pairedUsers();
            return users && users.length ? "label-success" : "";
        });

        self.refresh = function () {
            var pending = 2;
            var settled = function () {
                if (--pending === 0) self.checking(false);
            };
            self.checking(true);

            OctoPrint.get("plugin/layer1/setup")
                .done(function (data) {
                    self.kiosk(data.kiosk);
                })
                .fail(function () {
                    self.kiosk(null);
                })
                .always(settled);

            // Its client library is only loaded while the Application Keys plugin is enabled
            if (!OctoPrint.plugins.appkeys) {
                self.appKeysOff(true);
                settled();
                return;
            }

            // Admins get every user's keys, everyone else only their own
            OctoPrint.plugins.appkeys
                .getAllKeys()
                .done(function (data) {
                    var users = _.uniq(
                        _.map(
                            _.filter(data.keys || [], function (key) {
                                return key.app_id === APP_NAME;
                            }),
                            "user_id"
                        )
                    );
                    self.appKeysOff(false);
                    self.pairedUsers(users);
                })
                .fail(function (xhr) {
                    self.appKeysOff(xhr.status === 404);
                    self.pairedUsers(null);
                })
                .always(settled);
        };

        self.onSettingsShown = function () {
            findSettings();
            self.refresh();
        };

        // OctoPrint passes "#wizard_plugin_layer1" when the wizard opens on this step and
        // "wizard_plugin_layer1" when someone moves to it
        self.onAfterWizardTabChange = function (current) {
            if (String(current).replace(/^#/, "") === "wizard_plugin_layer1") self.refresh();
        };
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: Layer1SetupViewModel,
        dependencies: ["settingsViewModel", "printerProfilesViewModel"],
        elements: ["#settings_plugin_layer1", "#wizard_plugin_layer1"]
    });
});
