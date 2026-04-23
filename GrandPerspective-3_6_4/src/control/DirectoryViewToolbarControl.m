/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "DirectoryViewToolbarControl.h"

#import "DirectoryViewControl.h"
#import "DirectoryView.h"
#import "DirectoryViewControlSettings.h"
#import "DirectoryViewDisplaySettings.h"

#import "ToolbarSegmentedCell.h"
#import "MainMenuControl.h"
#import "LocalizableStrings.h"

#import "TreeContext.h"


NSString  *ToolbarZoom = @"Zoom"; 
NSString  *ToolbarFocus = @"Focus"; 
NSString  *ToolbarOpenItem = @"OpenItem";
NSString  *ToolbarPreviewItem = @"PreviewItem";
NSString  *ToolbarRevealItem = @"RevealItem";
NSString  *ToolbarDeleteItem = @"DeleteItem";
NSString  *ToolbarRescan = @"Rescan";
NSString  *ToolbarShowInfo = @"ShowInfo";
NSString  *ToolbarSearch = @"Search";


// Tags for each of the segments in the Zoom and Focus controls, so that the 
// order can be changed in the nib file.
static const NSUInteger ZOOM_IN_TAG     = 100;
static const NSUInteger ZOOM_OUT_TAG    = 101;
static const NSUInteger FOCUS_UP_TAG    = 102;
static const NSUInteger FOCUS_DOWN_TAG  = 103;
static const NSUInteger ZOOM_RESET_TAG  = 104;
static const NSUInteger FOCUS_RESET_TAG = 105;


@interface DirectoryViewToolbarControl (PrivateMethods)

/* Registers that the given selector should be used for creating the toolbar item with the given
 * identifier.
 */
- (void) createToolbarItem:(NSString *)identifier usingSelector:(SEL)selector;

@property (nonatomic, readonly, copy) NSToolbarItem *zoomToolbarItem;
@property (nonatomic, readonly, copy) NSToolbarItem *focusToolbarItem;
@property (nonatomic, readonly, copy) NSToolbarItem *openItemToolbarItem;
@property (nonatomic, readonly, copy) NSToolbarItem *previewItemToolbarItem;
@property (nonatomic, readonly, copy) NSToolbarItem *revealItemToolbarItem;
@property (nonatomic, readonly, copy) NSToolbarItem *deleteItemToolbarItem;
@property (nonatomic, readonly, copy) NSToolbarItem *rescanToolbarItem;
@property (nonatomic, readonly, copy) NSToolbarItem *showInfoToolbarItem;
@property (nonatomic, readonly, copy) NSToolbarItem *searchToolbarItem;

- (id) validateZoomControls:(NSToolbarItem *)toolbarItem;
- (id) validateFocusControls:(NSToolbarItem *)toolbarItem;

- (BOOL) validateAction:(SEL)action;


- (void) zoom:(id)sender;
- (void) focus:(id)sender;

- (void) moveFocusUp:(id)sender;
- (void) moveFocusDown:(id)sender;
- (void) resetFocus:(id)sender;

- (void) search:(id)sender;

// Methods corresponding to methods in DirectoryViewControl
- (void) openFile:(id)sender;
- (void) previewFile:(id)sender;
- (void) revealFileInFinder:(id)sender;
- (void) deleteFile:(id)sender;

// Methods corresponding to methods in MainMenuControl
- (void) refresh:(id)sender;
- (void) rescan:(id)sender;

@end


@interface ToolbarItemMenu : NSMenuItem {
}

// Override designated initialisers
- (instancetype) initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;
- (instancetype) initWithTitle:(NSString *)string
                        action:(nullable SEL)selector
                 keyEquivalent:(NSString *)charCode NS_UNAVAILABLE;

- (instancetype) initWithTitle:(NSString *)title target:(id)target NS_DESIGNATED_INITIALIZER;

- (NSMenuItem *) addAction:(SEL)action withTitle:(NSString *)title;

@end


@interface SelectorObject : NSObject {
  SEL  selector;
}

// Overrides designated initialiser
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithSelector:(SEL)selector NS_DESIGNATED_INITIALIZER;

@property (nonatomic, readonly) SEL selector;

@end


@interface ValidatingToolbarItem : NSToolbarItem {
  NSObject  *validator;
  SEL  validationSelector;
}

// Overrides designated initialiser
- (instancetype) initWithItemIdentifier:(NSString *)identifier NS_UNAVAILABLE;

- (instancetype) initWithItemIdentifier:(NSString *)identifier
                              validator:(NSObject *)validator
                     validationSelector:(SEL)validationSelector NS_DESIGNATED_INITIALIZER;

@end


@implementation DirectoryViewToolbarControl

- (instancetype) init {
  if (self = [super init]) {
    dirViewControl = nil; // Will be set when loaded from nib.
    
    // Set defaults (can be overridden when segments are tagged)
    zoomInSegment = 0;
    zoomOutSegment = 1;
    focusUpSegment = 0;
    focusDownSegment = 1;
  }
  return self;
}

- (void) dealloc {
  // We were not retaining it, so should not call -release 
  dirViewControl = nil;

  [super dealloc];
}


- (void) awakeFromNib {
  // Not retaining it. It needs to be deallocated when the window is closed.
  dirViewControl = dirViewWindow.windowController;
  
  // Set all images to template so that they also look good in Dark Mode. Somehow it does not
  // suffice to set Render As to "Template Image" in the image asset.
  [zoomControls.cell setImagesToTemplate];
  [focusControls.cell setImagesToTemplate];

  // Disable auto-layout for toolbar controls. This is apparantly needed for the toolbar to be layed
  // out correctly.
  [zoomControls setTranslatesAutoresizingMaskIntoConstraints: YES];
  [focusControls setTranslatesAutoresizingMaskIntoConstraints: YES];

  // Set the actions for the controls. This is not done in Interface Builder as changing the cells
  // resets it again. Furthermore, might as well do it here once, as opposed to in all (localized)
  // versions of the NIB file.
  zoomControls.target = self;
  zoomControls.action = @selector(zoom:); 
  focusControls.target = self;
  focusControls.action = @selector(focus:);
  
  NSUInteger  i;
  
  // Check if tags have been used to change default segment ordering 
  i = zoomControls.segmentCount;
  while (i-- > 0) {
    NSUInteger  tag = [zoomControls.cell tagForSegment: i];
    switch (tag) {
      case ZOOM_IN_TAG:
        zoomInSegment = i; break;
      case ZOOM_OUT_TAG:
        zoomOutSegment = i; break;
      case ZOOM_RESET_TAG:
        zoomResetSegment = i; break;
    }
  }

  i = focusControls.segmentCount;
  while (i-- > 0) {
    NSUInteger  tag = [focusControls.cell tagForSegment: i];
    switch (tag) {
      case FOCUS_UP_TAG:
        focusUpSegment = i; break;
      case FOCUS_DOWN_TAG:
        focusDownSegment = i; break;
      case FOCUS_RESET_TAG:
        focusResetSegment = i; break;
    }
  }

  
  NSToolbar  *toolbar = 
    [[[NSToolbar alloc] initWithIdentifier: @"DirectoryViewToolbar"] 
         autorelease];
           
  [toolbar setAllowsUserCustomization: YES];
  [toolbar setAutosavesConfiguration: YES]; 
  toolbar.displayMode = NSToolbarDisplayModeIconAndLabel;

  toolbar.delegate = self;
  dirViewControl.window.toolbar = toolbar;
}


NSMutableDictionary  *createToolbarItemLookup = nil;

- (NSToolbarItem *)toolbar:(NSToolbar *)toolbar
     itemForItemIdentifier:(NSString *)itemIdentifier
 willBeInsertedIntoToolbar:(BOOL)flag {
  if (createToolbarItemLookup == nil) {
    createToolbarItemLookup = [[NSMutableDictionary alloc] initWithCapacity: 8];

    [self createToolbarItem: ToolbarZoom
              usingSelector: @selector(zoomToolbarItem)];
    [self createToolbarItem: ToolbarFocus
              usingSelector: @selector(focusToolbarItem)];
    [self createToolbarItem: ToolbarOpenItem 
              usingSelector: @selector(openItemToolbarItem)];
    [self createToolbarItem: ToolbarPreviewItem
              usingSelector: @selector(previewItemToolbarItem)];
    [self createToolbarItem: ToolbarRevealItem
              usingSelector: @selector(revealItemToolbarItem)];
    [self createToolbarItem: ToolbarDeleteItem 
              usingSelector: @selector(deleteItemToolbarItem)];
    [self createToolbarItem: ToolbarRescan 
              usingSelector: @selector(rescanToolbarItem)];
    [self createToolbarItem: ToolbarShowInfo
              usingSelector: @selector(showInfoToolbarItem)];
    [self createToolbarItem: ToolbarSearch
              usingSelector: @selector(searchToolbarItem)];
  }
  
  SelectorObject  *selObj = createToolbarItemLookup[itemIdentifier];
  if (selObj == nil) {
    // May happen when user preferences refers to old/outdated toolbar items
    NSLog(@"Unrecognized toolbar item: %@", itemIdentifier);
    return nil;
  }
  
  return [self performSelector: [selObj selector]];
}

- (NSArray *)toolbarDefaultItemIdentifiers:(NSToolbar*)toolbar {
    return @[ToolbarZoom, ToolbarFocus,
             NSToolbarSpaceItemIdentifier,
             ToolbarOpenItem, ToolbarPreviewItem,
             ToolbarRevealItem, ToolbarDeleteItem,
             NSToolbarSpaceItemIdentifier,
             ToolbarRescan,
             NSToolbarFlexibleSpaceItemIdentifier,
             ToolbarSearch,
             ToolbarShowInfo];
}

- (NSArray *)toolbarAllowedItemIdentifiers:(NSToolbar*)toolbar {
    return @[ToolbarZoom, ToolbarFocus,
             ToolbarOpenItem, ToolbarPreviewItem,
             ToolbarRevealItem, ToolbarDeleteItem,
             ToolbarRescan,
             ToolbarShowInfo,
             ToolbarSearch,
             NSToolbarSpaceItemIdentifier,
             NSToolbarFlexibleSpaceItemIdentifier];
}

@end


@implementation DirectoryViewToolbarControl (PrivateMethods)

- (void) createToolbarItem:(NSString *)identifier
             usingSelector:(SEL)selector {
  id  obj = [[[SelectorObject alloc] initWithSelector: selector] autorelease];

  createToolbarItemLookup[identifier] = obj;
}


- (NSToolbarItem *) zoomToolbarItem {
  NSToolbarItem  *item =
    [[[ValidatingToolbarItem alloc] initWithItemIdentifier: ToolbarZoom
                                                 validator: self
                                         validationSelector: @selector(validateZoomControls:)]
     autorelease];

  NSString  *title = NSLocalizedStringFromTable(@"Zoom", @"Toolbar", @"Label for zooming controls");
  NSString  *zoomOutTitle = NSLocalizedStringFromTable(@"Zoom out", @"Toolbar", @"Toolbar action");
  NSString  *zoomInTitle = NSLocalizedStringFromTable(@"Zoom in", @"Toolbar", @"Toolbar action");
  NSString  *resetTitle = NSLocalizedStringFromTable(@"Reset zoom", @"Toolbar", @"Toolbar action");

  item.label = title;
  item.paletteLabel = item.label;
  item.view = zoomControls;
  
  // Tool tips set here (as opposed to Interface Builder) so that all toolbar-related text is in the
  // same file, to facilitate localization.
  [zoomControls.cell setToolTip: zoomInTitle  forSegment: zoomInSegment];
  [zoomControls.cell setToolTip: zoomOutTitle forSegment: zoomOutSegment];
  [zoomControls.cell setToolTip: resetTitle   forSegment: zoomResetSegment];

  ToolbarItemMenu  *menu =
    [[[ToolbarItemMenu alloc] initWithTitle: title target: self] autorelease];
  NSMenuItem  *zoomOutItem = [menu addAction: @selector(zoomOut:) withTitle: zoomOutTitle];
  NSMenuItem  *zoomInItem = [menu addAction: @selector(zoomIn:) withTitle: zoomInTitle];
  NSMenuItem  *zoomResetItem __unused =
    [menu addAction: @selector(resetZoom:) withTitle: resetTitle];

  // Set the key equivalents so that they show up in the menu (which may help to make the user aware
  // of them or remind the user of them). They do not actually have an effect. Handling these key
  // equivalents is handled in the DirectoryView class.
  zoomOutItem.keyEquivalent = @"-";
  zoomOutItem.keyEquivalentModifierMask = NSEventModifierFlagCommand;
  
  zoomInItem.keyEquivalent = @"+";
  zoomInItem.keyEquivalentModifierMask = NSEventModifierFlagCommand;

  item.menuFormRepresentation = menu;

  return item;
}

- (NSToolbarItem *)focusToolbarItem {
  NSToolbarItem  *item =
    [[[ValidatingToolbarItem alloc] initWithItemIdentifier: ToolbarFocus
                                                 validator: self
                                        validationSelector: @selector(validateFocusControls:)]
     autorelease];

  NSString  *title = NSLocalizedStringFromTable(@"Focus", @"Toolbar", @"Label for focus controls");
  NSString  *moveUpTitle =
    NSLocalizedStringFromTable(@"Move focus up", @"Toolbar", @"Toolbar action");
  NSString  *moveDownTitle =
    NSLocalizedStringFromTable(@"Move focus down", @"Toolbar", @"Toolbar action");
  NSString  *resetTitle = NSLocalizedStringFromTable(@"Reset focus", @"Toolbar", @"Toolbar action");

  item.label = title;
  item.paletteLabel = item.label;
  item.view = focusControls;

  // Tool tips set here (as opposed to Interface Builder) so that all toolbar-related text is in the
  // same file, to facilitate localization.
  [focusControls.cell setToolTip: moveDownTitle forSegment: focusDownSegment];
  [focusControls.cell setToolTip: moveUpTitle   forSegment: focusUpSegment];
  [focusControls.cell setToolTip: resetTitle    forSegment: focusResetSegment];

  ToolbarItemMenu  *menu =
    [[[ToolbarItemMenu alloc] initWithTitle: title target: self] autorelease];
  [menu addAction: @selector(moveFocusUp:) withTitle: moveUpTitle];
  [menu addAction: @selector(moveFocusDown:) withTitle: moveDownTitle];
  [menu addAction: @selector(resetFocus:) withTitle: resetTitle];

  item.menuFormRepresentation = menu;

  return item;
}

- (NSToolbarItem *)openItemToolbarItem {
  NSToolbarItem  *item =
    [[[NSToolbarItem alloc] initWithItemIdentifier: ToolbarOpenItem] autorelease];

  [item setLabel: NSLocalizedStringFromTable(@"Open", @"Toolbar", @"Toolbar action")];
  item.paletteLabel = item.label;
  [item setToolTip: NSLocalizedStringFromTable(@"Open with Finder", @"Toolbar", @"Tooltip")];
  item.image = [NSImage imageWithSystemSymbolName: @"book"
                         accessibilityDescription: nil];
  item.action = @selector(openFile:);
  item.target = self;

  return item;
}

- (NSToolbarItem *)previewItemToolbarItem {
  NSToolbarItem  *item =
    [[[NSToolbarItem alloc] initWithItemIdentifier: ToolbarPreviewItem] autorelease];

  [item setLabel: NSLocalizedStringFromTable(@"Quick Look", @"Toolbar", @"Toolbar action")];
  item.paletteLabel = item.label;
  [item setToolTip:
    NSLocalizedStringFromTable(@"Preview item in Quick Look panel", @"Toolbar", @"Tooltip")];
  item.image = [NSImage imageWithSystemSymbolName: @"eye"
                         accessibilityDescription: nil];
  item.action = @selector(previewFile:);
  item.target = self;

  return item;
}

- (NSToolbarItem *)revealItemToolbarItem {
  NSToolbarItem  *item = 
    [[[NSToolbarItem alloc] initWithItemIdentifier: ToolbarRevealItem] autorelease];

  [item setLabel: NSLocalizedStringFromTable(@"Reveal", @"Toolbar", @"Toolbar action")];
  item.paletteLabel = item.label;
  [item setToolTip: NSLocalizedStringFromTable(@"Reveal in Finder", @"Toolbar", @"Tooltip" )];
  item.image = [NSImage imageWithSystemSymbolName: @"doc.viewfinder"
                         accessibilityDescription: nil];
  item.action = @selector(revealFileInFinder:);
  item.target = self;

  return item;
}

- (NSToolbarItem *)deleteItemToolbarItem {
  NSToolbarItem  *item = 
    [[[NSToolbarItem alloc] initWithItemIdentifier: ToolbarDeleteItem] autorelease];

  [item setLabel: NSLocalizedStringFromTable(@"Delete", @"Toolbar", @"Toolbar action")];
  item.paletteLabel = item.label;
  [item setToolTip: NSLocalizedStringFromTable(@"Move to trash", @"Toolbar", @"Tooltip")];
  item.image = [NSImage imageWithSystemSymbolName: @"trash"
                         accessibilityDescription: nil];
  item.action = @selector(deleteFile:);
  item.target = self;

  return item;
}

- (NSToolbarItem *)rescanToolbarItem {
  NSToolbarItem  *item =
    [[[NSToolbarItem alloc] initWithItemIdentifier: ToolbarRescan] autorelease];

  TreeContext  *treeContext = dirViewControl.treeContext;
  if (treeContext.monitorsSource) {
    [item setLabel: NSLocalizedStringFromTable(@"Refresh", @"Toolbar", @"Toolbar action")];
    [item setToolTip: NSLocalizedStringFromTable(@"Refresh view data", @"Toolbar", @"Tooltip")];
    item.action = @selector(refresh:);
  }
  else {
    [item setLabel: NSLocalizedStringFromTable(@"Rescan", @"Toolbar", @"Toolbar action")];
    [item setToolTip: NSLocalizedStringFromTable(@"Rescan view data", @"Toolbar", @"Tooltip")];
    item.action = @selector(rescan:);
  }

  item.paletteLabel = item.label;
  item.image = [NSImage imageWithSystemSymbolName: @"arrow.clockwise"
                         accessibilityDescription: nil];
  item.target = self;

  return item;
}

- (NSToolbarItem *)showInfoToolbarItem {
  NSToolbarItem  *item =
    [[[NSToolbarItem alloc] initWithItemIdentifier: ToolbarShowInfo] autorelease];

  [item setLabel: NSLocalizedStringFromTable(@"Info", @"Toolbar", @"Toolbar action")];
  item.paletteLabel = item.label;
  [item setToolTip: NSLocalizedStringFromTable(@"Show info", @"Toolbar", "Tooltip")];
  item.image = [NSImage imageWithSystemSymbolName: @"info.circle.fill"
                         accessibilityDescription: nil];
  item.action = @selector(showInfo:);
  item.target = dirViewControl;

  return item;
}

- (NSToolbarItem *)searchToolbarItem {
  NSToolbarItem  *item =
    [[[NSToolbarItem alloc] initWithItemIdentifier: ToolbarSearch] autorelease];

  NSSearchField  *searchField = [[[NSSearchField alloc] init] autorelease];
  searchField.sendsWholeSearchString = NO;

  [item setToolTip: NSLocalizedStringFromTable(@"Search files by name", @"Toolbar", "Tooltip")];

  item.view = searchField;
  item.action = @selector(search:);
  item.target = self;

  return item;
}

- (id) validateZoomControls:(NSToolbarItem *)toolbarItem {
  NSSegmentedControl  *control = (NSSegmentedControl *)toolbarItem.view;
  DirectoryView  *dirView = dirViewControl.directoryView;

  [control setEnabled: dirView.canZoomOut forSegment: zoomOutSegment];
  [control setEnabled: dirView.canZoomIn forSegment: zoomInSegment];
  [control setEnabled: dirView.canZoomOut forSegment: zoomResetSegment];

  return self; // Always enable the overall control
}

- (id) validateFocusControls:(NSToolbarItem *)toolbarItem {
  NSSegmentedControl  *control = (NSSegmentedControl *)toolbarItem.view;

  [control setEnabled: [self validateAction: @selector(moveFocusUp:)]
           forSegment: focusUpSegment];
  [control setEnabled: [self validateAction: @selector(moveFocusDown:)]
           forSegment: focusDownSegment];
  [control setEnabled: [self validateAction: @selector(resetFocus:)]
           forSegment: focusResetSegment];

  return self; // Always enable the overall control
}

//----------------------------------------------------------------------------
// NSToolbarItemValidation

- (BOOL) validateToolbarItem:(NSToolbarItem *)item {
  return [self validateAction: item.action];
}

//----------------------------------------------------------------------------
// NSMenuItemValidation

- (BOOL) validateMenuItem:(NSMenuItem *)item {
  return [self validateAction: item.action];
}

//----------------------------------------------------------------------------

- (BOOL) validateAction:(SEL)action {
  if (action == @selector(moveFocusUp:)) {
    if (dirViewControl.isSelectedFileLocked) {
      return dirViewControl.directoryView.canMoveSelectionFocusUp;
    } else {
      return dirViewControl.directoryView.canMoveDisplayFocusUp;
    }
  }
  if (action == @selector(moveFocusDown:)) {
    if (dirViewControl.isSelectedFileLocked) {
      return dirViewControl.directoryView.canMoveSelectionFocusDown;
    } else {
      return dirViewControl.directoryView.canMoveDisplayFocusDown;
    }
  }
  if (action == @selector(resetFocus:)) {
    if (dirViewControl.isSelectedFileLocked) {
      return dirViewControl.directoryView.canResetSelectionFocus;
    } else {
      return dirViewControl.directoryView.canResetDisplayFocus;
    }
  }
  if (action == @selector(rescan:)) {
    return NSApplication.sharedApplication.mainWindow.windowController == dirViewControl;
  }
  if (action == @selector(refresh:)) {
    return ( NSApplication.sharedApplication.mainWindow.windowController == dirViewControl &&

             // There must be a monitored change
            dirViewControl.treeContext.numTreeChanges > 0);
  }

  if (action == @selector(search:)) {
    return YES;
  }

  if ([dirViewControl validateAction: action]) {
    return YES;
  }

  return NO;
}


- (void) zoom:(id)sender {
  NSUInteger  selected = [sender selectedSegment];

  if (selected == zoomInSegment) {
    [dirViewControl.directoryView zoomIn: sender];
  }
  else if (selected == zoomOutSegment) {
    [dirViewControl.directoryView zoomOut: sender];
  }
  else if (selected == zoomResetSegment) {
    [dirViewControl.directoryView resetZoom: sender];
  }
  else {
    NSAssert1(NO, @"Unexpected selected segment: %lu", (unsigned long)selected);
  }
}


- (void) focus:(id)sender {
  NSUInteger  selected = [sender selectedSegment];

  if (selected == focusDownSegment) {
    [self moveFocusDown: sender];
  }
  else if (selected == focusUpSegment) {
    [self moveFocusUp: sender];
  }
  else if (selected == focusResetSegment) {
    [self resetFocus: sender];
  }
  else {
    NSAssert1(NO, @"Unexpected selected segment: %lu", (unsigned long)selected);
  }
}


- (void) moveFocusUp:(id)sender {
  if (dirViewControl.isSelectedFileLocked) {
    [dirViewControl.directoryView moveSelectionFocusUp: sender];
  } else {
    [dirViewControl.directoryView moveDisplayFocusUp: sender];
  }
}

- (void) moveFocusDown:(id)sender {
  if (dirViewControl.isSelectedFileLocked) {
    [dirViewControl.directoryView moveSelectionFocusDown: sender];
  } else {
    [dirViewControl.directoryView moveDisplayFocusDown: sender];
  }
}

- (void) resetFocus:(id)sender {
  if (dirViewControl.isSelectedFileLocked) {
    [dirViewControl.directoryView resetSelectionFocus: sender];
  } else {
    [dirViewControl.directoryView resetDisplayFocus: sender];
  }
}


- (void) search:(id)sender {
  [dirViewControl searchForFiles: ((NSSearchField *)sender).stringValue];
}


- (void) openFile:(id)sender {
  [dirViewControl openFile: sender];
}

- (void) previewFile:(id)sender {
  [dirViewControl previewFile: sender];
}

- (void) revealFileInFinder:(id)sender {
  [dirViewControl revealFileInFinder: sender];
}

- (void) deleteFile:(id)sender {
  [dirViewControl deleteFile: sender];
}

- (void) refresh:(id)sender {
  [MainMenuControl.singletonInstance refresh: sender];
}

- (void) rescan:(id)sender {
  [MainMenuControl.singletonInstance rescan: sender];
}

@end // @implementation DirectoryViewToolbarControl (PrivateMethods)


@implementation ToolbarItemMenu

- (instancetype) initWithTitle:(NSString *)title {
  return [self initWithTitle: title target: nil];
}

- (instancetype) initWithTitle:(NSString *)title target:(id)target {
  if (self = [super initWithTitle: title action: nil keyEquivalent: @""]) {
    self.target = target; // Using target for setting target of subitems.
    
    NSMenu  *submenu = [[[NSMenu alloc] initWithTitle: title] autorelease];
    [submenu setAutoenablesItems: YES];

    self.submenu = submenu;
  }
  
  return self;
}


- (NSMenuItem *)addAction:(SEL)action withTitle:(NSString *)title {
  NSMenuItem  *item =
    [[[NSMenuItem alloc] initWithTitle: title action: action keyEquivalent: @""] autorelease];
  item.target = self.target;
  [self.submenu addItem: item];

  return item;
}

@end // @implementation ToolbarItemMenu


@implementation ValidatingToolbarItem

- (instancetype) initWithItemIdentifier:(NSString *)identifier
                              validator:(NSObject *)validatorVal
                     validationSelector:(SEL)validationSelectorVal {
  if (self = [super initWithItemIdentifier: identifier]) {
    validator = [validatorVal retain];
    validationSelector = validationSelectorVal;
  }
  return self;
}

- (void) dealloc {
  [validator release];
  
  [super dealloc];
}


- (void) validate {
  // Any non-nil value means that the control should be enabled.
  self.enabled = [validator performSelector: validationSelector withObject: self] != nil;
}

@end // @implementation ValidatingToolbarItem


@implementation SelectorObject

- (instancetype) initWithSelector:(SEL)selectorVal {
  if (self = [super init]) {
    selector = selectorVal;
  }
  return self;
}

- (SEL) selector {
  return selector;
}

@end // @implementation SelectorObject


